import { ActivityRecorder } from './activity'
import { randomUUID } from 'node:crypto'
import { Agent, Runner, tool } from '@openai/agents-core'
import { z } from 'zod'
import type {
  AgentExecutionView,
  AgentPlanStep,
  AgentQuote,
  AgentRole
} from '../../shared/agent-runtime'
import type {
  AskWechatQueryRequest,
  AskWechatQueryResult,
  AskWechatScope,
  QueryAgentProgressEvent
} from '../../shared/query-agent'
import { LOCAL_QUERY_TOOL_DEFINITIONS } from '../../shared/local-query-api'
import {
  EvidenceCollector,
  newRetryState,
  type QueryAgentToolExecutor
} from '../services/query-agent-service'
import { sanitizeAnswerCitations } from '../services/ai-search-evidence'
import { DEFAULT_LIMITS, RunBudget, type RuntimeLimits } from './budget'
import { ProviderModel, type RuntimeProvider } from './model'
import { SkillRegistry } from './skills'
import { buildAgentPrompt } from './prompts'
import { RuntimeStore, type Artifact, type RunSnapshot } from './store'
import { serialTools } from './tool-queue'
import { QueryGateway } from './gateway'

const planSchema = z.object({
  steps: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z0-9-]{1,40}$/),
        objective: z.string().min(1).max(1200),
        role: z.enum(['retriever', 'analyst', 'verifier']),
        dependencies: z.array(z.string()).max(4),
        doneWhen: z.string().min(1).max(600),
        instructions: z.string().max(2000).optional(),
        skills: z.array(z.string()).max(2).optional(),
        quoteIndexes: z.array(z.number().int().min(0)).max(30).optional()
      })
    )
    .min(1)
    .max(4)
})
export class AgentRuntimeHost {
  private readonly active = new Map<
    string,
    { owner: string; sessionKey: string; controller: AbortController; forgotten?: boolean }
  >()
  private readonly runner = new Runner({ tracingDisabled: true, traceIncludeSensitiveData: false })
  constructor(
    private readonly provider: RuntimeProvider,
    private readonly execute: QueryAgentToolExecutor,
    private readonly skills: SkillRegistry,
    private readonly store: RuntimeStore,
    private readonly limits: RuntimeLimits = DEFAULT_LIMITS
  ) {}

  cancelAll(): void {
    for (const run of this.active.values()) run.controller.abort(new Error('数据连接已变更'))
  }
  cancelOwner(owner: string): void {
    for (const run of this.active.values())
      if (run.owner === owner) run.controller.abort(new Error('窗口已关闭'))
  }
  catalog(): ReturnType<SkillRegistry['catalog']> {
    return this.skills.catalog()
  }
  cancel(requestId: string, owner: string): boolean {
    const run = this.active.get(requestId)
    if (!run || run.owner !== owner) return false
    run.controller.abort(new Error('用户已停止本次任务'))
    return true
  }
  forget(owner: string, scope: AskWechatScope): void {
    const key = this.sessionKey(owner, scope)
    for (const run of this.active.values())
      if (run.sessionKey === key) {
        run.forgotten = true
        run.controller.abort(new Error('会话已重置'))
      }
    this.store.forget(key)
  }
  private sessionKey(owner: string, scope: AskWechatScope): string {
    return `${owner}:${JSON.stringify(scope.scope)}`
  }

  async ask(
    request: AskWechatQueryRequest,
    owner: string,
    progress?: (event: QueryAgentProgressEvent) => void
  ): Promise<AskWechatQueryResult> {
    const started = Date.now()
    const config = this.provider.getRuntimeConfig()
    const diagnostic = () => ({
      entry: 'desktop' as const,
      provider: config.providerName,
      model: config.model,
      modelCallCount: budget.modelCalls,
      toolCallCount: budget.toolCalls,
      tools: usedTools,
      totalMs: Date.now() - started,
      outcome: 'answered' as const
    })
    const budget = new RunBudget(this.limits)
    const usedTools: string[] = []
    const reads = { messageCount: 0, matchedCount: 0, overviewSourceCount: 0 }
    if (!request.scope || !request.requestId || request.text.length > 32_000) {
      return {
        engine: 'query-agent',
        status: 'error',
        message: '请指定会话范围，问题不应超过 32000 字符',
        diagnostics: { ...diagnostic(), outcome: 'invalid_question' }
      }
    }
    if (!config.configured)
      return {
        engine: 'query-agent',
        status: 'provider_unavailable',
        message: '请先配置 AI 模型',
        diagnostics: { ...diagnostic(), outcome: 'provider_unavailable' }
      }
    const scope = structuredClone(request.scope)
    const sessionKey = this.sessionKey(owner, scope)
    if (
      this.active.size >= 2 ||
      this.active.has(request.requestId) ||
      [...this.active.values()].some((r) => r.sessionKey === sessionKey)
    ) {
      return {
        engine: 'query-agent',
        status: 'error',
        message: '当前会话仍有任务运行，请先停止',
        diagnostics: { ...diagnostic(), outcome: 'runtime_error' }
      }
    }
    const controller = new AbortController()
    const timer = setTimeout(
      () => controller.abort(new Error('任务执行超时')),
      this.limits.timeoutMs
    )
    this.active.set(request.requestId, { owner, sessionKey, controller })
    const signal = controller.signal
    const view: AgentExecutionView = {
      runId: request.requestId,
      state: 'running',
      planVersion: 0,
      steps: [],
      skills: [],
      modelCalls: 0,
      toolCalls: 0,
      tokens: 0,
      tokensEstimated: false,
      resumable: false
    }
    const ledger = new EvidenceCollector()
    const temporalLock = newRetryState()
    const artifacts = new Map<string, Artifact>()
    const skillHashes: Record<string, string> = {}
    const session = this.store.load(sessionKey)
    const emit = (stage: QueryAgentProgressEvent['stage'], toolName?: string): void => {
      Object.assign(view, {
        modelCalls: budget.modelCalls,
        toolCalls: budget.toolCalls,
        tokens: budget.tokens,
        tokensEstimated: budget.estimated
      })
      try {
        progress?.({
          stage,
          at: Date.now(),
          elapsedMs: Date.now() - started,
          modelCallCount: budget.modelCalls,
          toolCallCount: budget.toolCalls,
          toolName,
          execution: structuredClone(view)
        })
      } catch {
        /* UI observers cannot break a run. */
      }
    }
    const activity = new ActivityRecorder((items) => {
      view.activities = items
      emit('organizing_evidence')
    })
    const observeTools =
      (parentId?: string, toolSignal = signal) =>
      (name: string, work: () => Promise<unknown>) =>
        LOCAL_QUERY_TOOL_DEFINITIONS.some((t) => t.name === name)
          ? work()
          : activity.tool(name, work, toolSignal, parentId)
    let storedQuotes = request.quotes || []
    const snapshot = (): RunSnapshot => ({
      owner,
      scopeKey: sessionKey,
      question: request.text,
      view: structuredClone(view),
      artifacts: [...artifacts.values()],
      evidence: ledger.list(),
      quotes: storedQuotes,
      skillHashes: { ...skillHashes }
    })
    const checkpoint = (): void => {
      emit('organizing_evidence')
      session.runs = session.runs.filter((run) => run.view.runId !== view.runId)
      session.runs.push(snapshot())
      if (!this.active.get(request.requestId)?.forgotten) this.store.save(sessionKey, session)
    }
    const check = (): void => signal.throwIfAborted()
    const beforeTool = (name: string): void => {
      check()
      if (!LOCAL_QUERY_TOOL_DEFINITIONS.some((t) => t.name === name)) budget.tool()
    }
    const loadSkill = (id: string, role: AgentRole, parentId?: string): string => {
      check()
      const skill = this.skills.load(id, role)
      if (skillHashes[id] && skillHashes[id] !== skill.hash)
        throw new Error('Skill 已变更，请重新开始任务')
      skillHashes[id] = skill.hash
      if (!view.skills.includes(id)) view.skills.push(id)
      emit('understanding')
      const loaded = activity.start('skill', skill.name, parentId)
      activity.finish(loaded, 'completed', skill.description)
      return skill.body
    }
    const model = (final = false, modelSignal = signal): ProviderModel =>
      new ProviderModel(
        this.provider,
        budget,
        modelSignal,
        () => emit(final ? 'generating_answer' : 'understanding'),
        final
      )
    const skillTool = (role: AgentRole) =>
      tool({
        name: 'load_skill',
        description: '按需读取工作方法，不能提升权限。',
        parameters: z.object({ id: z.string() }),
        execute: async ({ id }) => loadSkill(id, role)
      })
    const policy = buildAgentPrompt('main', scope, this.skills.catalog('main'))
    const makeQueryTools = (gateway: QueryGateway, parentId?: string, toolSignal = signal) =>
      LOCAL_QUERY_TOOL_DEFINITIONS.map((definition) =>
        tool({
          name: definition.name,
          description: definition.description,
          strict: false,
          parameters: { ...definition.parameters, additionalProperties: true } as {
            type: 'object'
            properties: Record<string, unknown>
            required: string[]
            additionalProperties: true
          },
          execute: async (input: unknown) => {
            const result = await activity.tool(
              definition.name,
              () => gateway.call(definition.name, input),
              toolSignal,
              parentId,
              input
            )
            check()
            return result
          }
        })
      )
    const gatewayFor = (objective: string, querySignal = signal): QueryGateway =>
      new QueryGateway(
        this.execute,
        scope,
        `${request.text}\n${objective}`,
        budget,
        querySignal,
        (name) => {
          usedTools.push(name)
          emit('searching', name)
        },
        ledger,
        reads,
        temporalLock
      )
    const validatePlan = (steps: z.infer<typeof planSchema>['steps']): void => {
      const ids = new Set<string>()
      for (const step of steps) {
        if (ids.has(step.id) || step.dependencies.some((id) => !ids.has(id)))
          throw new Error('计划步骤必须唯一，依赖只能引用前面的步骤')
        if ((step.quoteIndexes || []).some((index) => index >= storedQuotes.length))
          throw new Error('计划引用编号越界')
        if (step.role !== 'retriever' && !step.dependencies.length && !step.quoteIndexes?.length)
          throw new Error('分析和核验任务必须有依赖材料或指定引用')
        for (const id of step.skills || []) this.skills.load(id, step.role)
        ids.add(step.id)
      }
      if (view.steps.some((step) => step.state === 'running'))
        throw new Error('请等待运行中的子任务结束后再修改计划')
      const retained = new Set<string>()
      view.steps = steps.map((step) => {
        const previous = view.steps.find((old) => old.id === step.id)
        const same =
          previous &&
          previous.objective === step.objective &&
          previous.role === step.role &&
          previous.doneWhen === step.doneWhen &&
          previous.instructions === step.instructions &&
          JSON.stringify(previous.skills || []) === JSON.stringify(step.skills || []) &&
          JSON.stringify(previous.quoteIndexes || []) === JSON.stringify(step.quoteIndexes || []) &&
          JSON.stringify(previous.dependencies) === JSON.stringify(step.dependencies) &&
          step.dependencies.every((id) => retained.has(id))
        if (same && previous.state === 'completed') retained.add(step.id)
        return {
          ...step,
          state: same && previous.state === 'completed' ? 'completed' : 'queued',
          ...(same && previous.artifactId ? { artifactId: previous.artifactId } : {})
        } as AgentPlanStep
      })
      for (const step of steps)
        for (const id of step.skills || []) skillHashes[id] = this.skills.load(id, step.role).hash
      view.planVersion++
      checkpoint()
    }
    const createPlan = async (objective: string): Promise<unknown> => {
      check()
      const plannerActivity = activity.start('agent', 'Planner · 制定计划')
      const previousVersion = view.planVersion
      const planner = new Agent({
        name: 'planner',
        model: model(),
        modelSettings: { parallelToolCalls: false },
        instructions: buildAgentPrompt('planner', scope, this.skills.catalog()),
        toolUseBehavior: { stopAtToolNames: ['submit_plan'] },
        tools: serialTools(
          [
            tool({
              name: 'submit_plan',
              description: '保存有界任务计划',
              parameters: planSchema,
              execute: async ({ steps }) => {
                validatePlan(steps)
                return view.steps
              }
            })
          ],
          beforeTool,
          observeTools(plannerActivity)
        )
      })
      await this.runner.run(
        planner,
        JSON.stringify({
          objective,
          userQuotes: storedQuotes.map(({ sender, text }, index) => ({ index, sender, text })),
          history: request.history,
          existing: view.steps
        }),
        { signal, maxTurns: 3 }
      )
      if (view.planVersion === previousVersion) throw new Error('Planner 没有生成可执行计划')
      activity.finish(plannerActivity, 'completed', `已生成 ${view.steps.length} 个步骤`)
      return { version: view.planVersion, steps: view.steps }
    }
    const executeStep = async (step: AgentPlanStep): Promise<Artifact> => {
      check()
      if (step.state === 'completed' && step.artifactId && artifacts.has(step.artifactId))
        return artifacts.get(step.artifactId)!
      budget.child()
      const childActivity = activity.start('agent', step.role + ' · ' + step.objective)
      step.state = 'running'
      checkpoint()
      const childSignal = AbortSignal.any([signal, AbortSignal.timeout(this.limits.taskTimeoutMs)])
      const gateway = gatewayFor(step.objective, childSignal)
      try {
        const inputs = step.dependencies
          .map((id) => view.steps.find((s) => s.id === id)?.artifactId)
          .flatMap((id) => (id && artifacts.has(id) ? [artifacts.get(id)!] : []))
        gateway.grant(inputs.flatMap((a) => a.evidence))
        const child = new Agent({
          name: step.role,
          model: model(false, childSignal),
          modelSettings: { parallelToolCalls: false },
          instructions: buildAgentPrompt(step.role, scope),
          tools: serialTools(
            step.role === 'analyst' ? [] : makeQueryTools(gateway, childActivity, childSignal),
            beforeTool,
            observeTools(childActivity, childSignal)
          )
        })
        const output = await this.runner.run(
          child,
          JSON.stringify({
            objective: step.objective,
            doneWhen: step.doneWhen,
            instructions: step.instructions,
            skills: (step.skills || []).map((id) => ({
              id,
              body: loadSkill(id, step.role, childActivity),
              hash: skillHashes[id]
            })),
            userQuotes: (step.quoteIndexes || [])
              .map((index) => storedQuotes[index])
              .map(({ sender, text }) => ({
                sender,
                text,
                provenance: 'user-provided'
              })),
            inputs: inputs.map((a) => ({ summary: a.summary, evidence: a.evidence }))
          }),
          { signal: childSignal, maxTurns: 5 }
        )
        check()
        const evidence = gateway
          .visibleEvidence()
          .slice(0, 12)
          .map((e) => ({ ...e, text: e.text?.slice(0, 600), imageOcrText: undefined }))
        const artifact: Artifact = {
          id: randomUUID(),
          taskId: step.id,
          status: 'completed',
          summary: sanitizeAnswerCitations(
            String(output.finalOutput || ''),
            evidence.map((e) => e.citationId)
          ).answer.slice(0, 3000),
          evidence
        }
        artifacts.set(artifact.id, artifact)
        step.artifactId = artifact.id
        activity.finish(childActivity, 'completed', artifact.summary)
        step.state = 'completed'
        checkpoint()
        return artifact
      } catch (error) {
        step.state = signal.aborted ? 'cancelled' : 'failed'
        const evidence = gateway
          .visibleEvidence()
          .slice(0, 12)
          .map((e) => ({ ...e, text: e.text?.slice(0, 600), imageOcrText: undefined }))
        if (!signal.aborted && evidence.length) {
          const artifact: Artifact = {
            id: randomUUID(),
            taskId: step.id,
            status: 'partial',
            summary: '子任务中断，仅获得部分证据，尚未完成分析。',
            evidence
          }
          artifacts.set(artifact.id, artifact)
          step.artifactId = artifact.id
          activity.finish(childActivity, 'partial', artifact.summary)
          step.state = 'partial'
          checkpoint()
          return artifact
        }
        activity.finish(childActivity, signal.aborted ? 'cancelled' : 'failed', '子任务未完成')
        checkpoint()
        throw error
      }
    }
    const executeTasks = async (ids: string[]): Promise<unknown> => {
      if (request.mode === 'plan') throw new Error('仅规划模式不能执行任务')
      const requested = [...new Set(ids)].map((id) => {
        const step = view.steps.find((s) => s.id === id)
        if (!step) throw new Error('任务不在当前计划中')
        return step
      })
      const results: unknown[] = []
      while (requested.length) {
        check()
        const ready = requested.filter((s) =>
          s.dependencies.every((id) => view.steps.find((p) => p.id === id)?.state === 'completed')
        )
        if (!ready.length)
          return {
            results,
            blocked: requested.map((s) => s.id),
            reason: '依赖任务尚未完成，不能执行'
          }
        const batch = ready.slice(0, this.limits.parallel)
        // Start bounded batches inside one orchestration tool; SDK tools themselves are sequential.
        const settled = await Promise.allSettled(batch.map(executeStep))
        settled.forEach((result, i) => {
          results.push(
            result.status === 'fulfilled'
              ? result.value
              : { task: batch[i].id, status: 'failed', error: String(result.reason) }
          )
          requested.splice(requested.indexOf(batch[i]), 1)
        })
      }
      return results
    }
    const synthesize = async (): Promise<string> => {
      const synthesis = new Agent({
        name: 'synthesizer',
        model: model(true),
        modelSettings: { parallelToolCalls: false },
        instructions: buildAgentPrompt('synthesizer', scope),
        tools: []
      })
      const result = await this.runner.run(
        synthesis,
        JSON.stringify({
          question: request.text,
          quotes: storedQuotes,
          evidence: ledger
            .list()
            .map((e) => ({ ...e, text: e.text?.slice(0, 800), imageOcrText: undefined })),
          artifacts: [...artifacts.values()].map(({ id, summary, status }) => ({
            id,
            summary: summary.slice(0, 1500),
            status
          })),
          incomplete: view.steps.filter((s) => s.state !== 'completed')
        }),
        { signal, maxTurns: 1 }
      )
      return String(result.finalOutput || '')
    }
    try {
      let quotes: AgentQuote[] = request.quotes || []
      if (request.resumeRunId) {
        const prior = session.runs.find((r) => r.view.runId === request.resumeRunId)
        if (!prior || prior.owner !== owner || prior.scopeKey !== sessionKey)
          throw new Error('无法恢复其他会话的任务')
        for (const [id, hash] of Object.entries(prior.skillHashes))
          if (this.skills.load(id).hash !== hash) throw new Error('Skill 已变更，请重新开始任务')
        view.steps = prior.view.steps.map((s) => ({
          ...s,
          state: s.state === 'completed' ? 'completed' : 'queued'
        }))
        view.planVersion = prior.view.planVersion
        if (prior.question !== request.text) throw new Error('恢复时必须使用原问题')
        quotes = prior.quotes
        storedQuotes = quotes
        Object.assign(skillHashes, prior.skillHashes)
        view.skills = [...prior.view.skills]
        ledger.addFromToolResult('restored', { status: 'completed', evidence: prior.evidence })
        for (const artifact of prior.artifacts) artifacts.set(artifact.id, artifact)
      }
      quotes = quotes.filter(
        (q) => scope.scope.kind === 'current' && q.conversationId === scope.scope.conversationId
      )
      if (quotes.length > 30 || JSON.stringify(quotes).length > 32_000)
        throw new Error('引用内容过多，请缩小引用范围')
      storedQuotes = quotes
      const input = JSON.stringify({
        question: request.text,
        quotes: quotes.map(({ sender, text }) => ({ sender, text, provenance: 'user-provided' })),
        history: (request.history || session.turns).slice(-6).map((t) => ({
          question: t.question.slice(0, 1000),
          answer: t.answer.replace(/\[E\d+\]/g, '').slice(0, 2000)
        })),
        restoredPlan: view.steps,
        restoredArtifacts: [...artifacts.values()].map(({ id, summary, evidence }) => ({
          id,
          summary,
          evidence
        }))
      })
      let answer: string
      let answerCitationIds: string[] = []
      if (request.mode === 'plan') {
        await createPlan(request.text)
        answer =
          '执行计划：\n\n' +
          view.steps
            .map((s, i) => `${i + 1}. ${s.objective}\n   完成标准：${s.doneWhen}`)
            .join('\n')
        view.state = 'planned'
      } else if (request.resumeRunId && view.steps.length) {
        await executeTasks(view.steps.filter((s) => s.state !== 'completed').map((s) => s.id))
        answer = await synthesize()
        answerCitationIds = ledger.citationIds()
        view.state = view.steps.some((s) => s.state !== 'completed') ? 'partial' : 'completed'
      } else {
        const gateway = gatewayFor(request.text)
        const rootTools = makeQueryTools(gateway).map((t) => t)
        const main = new Agent({
          name: 'main',
          model: model(),
          instructions: policy,
          modelSettings: { parallelToolCalls: false },
          tools: serialTools(
            [
              ...rootTools,
              skillTool('main'),
              tool({
                name: 'plan_task',
                description: '复杂问题生成或修订任务计划',
                parameters: z.object({ objective: z.string().max(2000) }),
                execute: async ({ objective }) => createPlan(objective)
              }),
              tool({
                name: 'run_tasks',
                description: '执行计划中的任务，独立任务最多两个并行',
                parameters: z.object({ ids: z.array(z.string()).min(1).max(4) }),
                execute: async ({ ids }) => executeTasks(ids)
              }),
              tool({
                name: 'read_artifact',
                description: '读取本次任务产物的片段',
                parameters: z.object({ id: z.string(), offset: z.number().int().min(0) }),
                execute: async ({ id, offset }) => {
                  check()
                  const artifact = artifacts.get(id)
                  if (!artifact) throw new Error('没有该产物的访问权限')
                  return { ...artifact, summary: artifact.summary.slice(offset, offset + 4000) }
                }
              })
            ],
            beforeTool,
            observeTools()
          )
        })
        try {
          const result = await this.runner.run(main, input, { signal, maxTurns: 10 })
          answer = String(result.finalOutput || '')
          answerCitationIds = [
            ...gateway.visibleEvidence(),
            ...[...artifacts.values()].flatMap((a) => a.evidence)
          ].map((e) => e.citationId)
        } catch (error) {
          check()
          if (!ledger.list().length && !artifacts.size) throw error
          answer = await synthesize()
          answerCitationIds = ledger.citationIds()
        }
        view.state = view.steps.some((s) => s.state !== 'completed') ? 'partial' : 'completed'
      }
      check()
      if (view.state === 'partial') answer = '部分任务尚未完成，以下为当前结果。\n\n' + answer
      activity.close('failed')
      const sanitized = sanitizeAnswerCitations(answer, answerCitationIds)
      view.resumable = view.state === 'planned' || view.steps.some((s) => s.state !== 'completed')
      session.turns.push({ question: request.text, answer: sanitized.answer })
      checkpoint()
      return {
        engine: 'query-agent',
        status: 'answered',
        answer: sanitized.answer,
        evidence: ledger.list(),
        invalidCitationIds: sanitized.invalidCitationIds,
        execution: view,
        stats: {
          tools: usedTools,
          reads: {
            ...reads,
            evidenceCount: ledger.list().length
          },
          scope: { kind: scope.scope.kind, label: scope.label },
          modelCallCount: budget.modelCalls,
          toolCallCount: budget.toolCalls,
          totalMs: Date.now() - started
        },
        diagnostics: diagnostic()
      }
    } catch (error) {
      activity.close(signal.aborted ? 'cancelled' : 'failed')
      view.state = signal.aborted ? 'cancelled' : 'failed'
      view.resumable = view.steps.length > 0
      checkpoint()
      return {
        engine: 'query-agent',
        status: 'error',
        message: signal.aborted
          ? String(signal.reason?.message || '任务已停止')
          : error instanceof Error
            ? error.message
            : 'Agent 执行失败',
        execution: view,
        diagnostics: { ...diagnostic(), outcome: 'runtime_error' }
      }
    } finally {
      clearTimeout(timer)
      this.active.delete(request.requestId)
      emit('completed')
    }
  }
}
