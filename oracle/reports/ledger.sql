-- دفتر الأستاذ لحساب برصيد جارٍ. المعاملات: :P_ACCOUNT (إلزامي) · :P_FROM · :P_TO (اختياريان)
-- الرصيد بالجانب الطبيعي للحساب: أصول ومصروفات مدينة، والباقي دائنة.
-- الصف الأول هو «رصيد أول الفترة» إن حُدِّد :P_FROM.
SELECT TO_DATE(NULL) AS entry_date, TO_NUMBER(NULL) AS entry_id, 'رصيد أول الفترة' AS memo,
       TO_NUMBER(NULL) AS debit, TO_NUMBER(NULL) AS credit,
       NVL((SELECT SUM(l2.debit - l2.credit) * CASE WHEN a2.acc_type IN ('ASSET','EXPENSE') THEN 1 ELSE -1 END
              FROM erp_accounts a2
              JOIN erp_lines   l2 ON l2.account_code = a2.code
              JOIN erp_entries e2 ON e2.entry_id = l2.entry_id AND e2.entry_date < :P_FROM
             WHERE a2.code = :P_ACCOUNT
             GROUP BY a2.acc_type), 0) AS balance,
       0 AS ord
  FROM dual
 WHERE :P_FROM IS NOT NULL
UNION ALL
SELECT e.entry_date, e.entry_id, e.memo, l.debit, l.credit,
       NVL((SELECT SUM(l2.debit - l2.credit) * CASE WHEN a2.acc_type IN ('ASSET','EXPENSE') THEN 1 ELSE -1 END
              FROM erp_accounts a2
              JOIN erp_lines   l2 ON l2.account_code = a2.code
              JOIN erp_entries e2 ON e2.entry_id = l2.entry_id AND e2.entry_date < :P_FROM
             WHERE a2.code = :P_ACCOUNT
             GROUP BY a2.acc_type), 0)
         + SUM((l.debit - l.credit) * CASE WHEN a.acc_type IN ('ASSET','EXPENSE') THEN 1 ELSE -1 END)
             OVER (ORDER BY e.entry_date, e.entry_id, l.line_id) AS balance,
       1 AS ord
  FROM erp_accounts a
  JOIN erp_lines   l ON l.account_code = a.code
  JOIN erp_entries e ON e.entry_id = l.entry_id
 WHERE a.code = :P_ACCOUNT
   AND (:P_FROM IS NULL OR e.entry_date >= :P_FROM)
   AND (:P_TO   IS NULL OR e.entry_date <= :P_TO)
 ORDER BY ord, entry_date, entry_id;
