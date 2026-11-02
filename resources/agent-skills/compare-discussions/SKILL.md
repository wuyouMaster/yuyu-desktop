---
name: compare-discussions
description: 当用户比较不同成员、方案或时期的观点与变化时使用；不用于普通单范围总结。
roles: main,retriever,analyst,verifier
version: 2
---

1. 明确比较对象、时期和维度。检索角色只查分配给自己的范围；已有材料的分析角色按相同维度对齐。
2. 精确时间或说话人用 query_messages；主题用 search_messages；只有整体讨论才用 conversation_overview。
3. 输出共同点、差异、变化及各方证据。区分说话人的原意、转述、否定和条件，不把发言次数当支持人数。
4. 有冲突先保留；有查询权限且关键语境不足才用 message_context。两个时期覆盖不对称时明确说明不能直接比较。
停止条件：各比较维度已有依据或明确缺口。未查到不能解释成沉默、反对或没有发生。
