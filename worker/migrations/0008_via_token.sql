-- Fills daily_breakdown's via_token rows for every rolled-up day: each day's direct sends (sender = origin, as stored),
-- keyed <src_selector>:<sender>|<group>, where group is the first token's registry group_id, or <chain>:<address> for a
-- token with none, as rollupDay keys them. One statement per calendar month keeps each inside D1's statement limits;
-- history starts on 2023-07-06 and every list message since then carries an origin. The last statement has no upper
-- bound, so days finalized between this file and the deploy are filled too. Re-running it upserts the same rows.
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2023-07-01' AND m.day < '2023-08-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2023-08-01' AND m.day < '2023-09-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2023-09-01' AND m.day < '2023-10-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2023-10-01' AND m.day < '2023-11-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2023-11-01' AND m.day < '2023-12-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2023-12-01' AND m.day < '2024-01-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2024-01-01' AND m.day < '2024-02-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2024-02-01' AND m.day < '2024-03-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2024-03-01' AND m.day < '2024-04-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2024-04-01' AND m.day < '2024-05-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2024-05-01' AND m.day < '2024-06-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2024-06-01' AND m.day < '2024-07-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2024-07-01' AND m.day < '2024-08-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2024-08-01' AND m.day < '2024-09-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2024-09-01' AND m.day < '2024-10-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2024-10-01' AND m.day < '2024-11-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2024-11-01' AND m.day < '2024-12-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2024-12-01' AND m.day < '2025-01-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2025-01-01' AND m.day < '2025-02-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2025-02-01' AND m.day < '2025-03-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2025-03-01' AND m.day < '2025-04-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2025-04-01' AND m.day < '2025-05-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2025-05-01' AND m.day < '2025-06-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2025-06-01' AND m.day < '2025-07-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2025-07-01' AND m.day < '2025-08-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2025-08-01' AND m.day < '2025-09-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2025-09-01' AND m.day < '2025-10-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2025-10-01' AND m.day < '2025-11-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2025-11-01' AND m.day < '2025-12-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2025-12-01' AND m.day < '2026-01-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2026-01-01' AND m.day < '2026-02-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2026-02-01' AND m.day < '2026-03-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2026-03-01' AND m.day < '2026-04-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2026-04-01' AND m.day < '2026-05-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2026-05-01' AND m.day < '2026-06-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2026-06-01' AND m.day < '2026-07-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2026-07-01' AND m.day < '2026-08-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2026-08-01' AND m.day < '2026-09-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2026-09-01' AND m.day < '2026-10-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
SELECT m.day, 'via_token', m.src_chain || ':' || m.sender || '|' || COALESCE(t.group_id, mt.chain || ':' || mt.token), COUNT(*), SUM(m.usd_value), SUM(m.fee_usd)
FROM messages m JOIN message_tokens mt ON mt.message_id = m.message_id AND mt.idx = 0 LEFT JOIN tokens t ON t.chain = mt.chain AND t.address = mt.token
WHERE m.day >= '2026-10-01' AND m.sender = m.origin AND m.day IN (SELECT day FROM daily_totals)
GROUP BY m.day, m.src_chain, m.sender, COALESCE(t.group_id, mt.chain || ':' || mt.token)
ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd;
