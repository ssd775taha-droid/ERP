-- دفتر اليومية. المعاملات: :P_FROM · :P_TO (اختياريان)
SELECT e.entry_id, e.entry_date, e.memo, e.ref,
       CASE WHEN e.void_of IS NOT NULL THEN 'عكسي' END AS entry_flag,
       l.account_code, a.name AS account_name, l.debit, l.credit
  FROM erp_entries e
  JOIN erp_lines l    ON l.entry_id = e.entry_id
  JOIN erp_accounts a ON a.code = l.account_code
 WHERE (:P_FROM IS NULL OR e.entry_date >= :P_FROM)
   AND (:P_TO   IS NULL OR e.entry_date <= :P_TO)
 ORDER BY e.entry_date, e.entry_id, l.line_id;
