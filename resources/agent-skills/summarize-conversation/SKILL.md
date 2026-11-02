---
name: summarize-conversation
description: 当用户总结某段聊天的主题、决定与待办时使用；不用于最早/最近单条记录、精确计数或全量审计。
roles: main,retriever,analyst
version: 2
---

1. 明确用户要求的时期和主题。检索角色可用 conversation_overview 获取覆盖样本；已有材料的分析角色直接归纳。
2. 将主题、确定决定、待办分开；不要把某个人的提议写成全群共识。
3. 对影响结论的关键决定，必要时用 search_messages 或 query_messages 补证据；只有语境不明再用 message_context。无查询权限则保留缺口。
4. 输出一句概述和简短分项，关键事实引用已有 [E#]。用户引用另注明来源。
停止条件：主要主题及关键结论已覆盖或预算/样本边界已明确。不把概览样本当全量，不推算未观察到的频率或人数。
