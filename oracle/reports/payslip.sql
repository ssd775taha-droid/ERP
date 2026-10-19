-- قسيمة راتب موظف. المعاملان: :P_RUN · :P_EMP (إلزاميان)
-- Q_HEAD
SELECT r.period, r.status, e.code AS emp_code, e.name AS emp_name, e.job_title, d.name AS dept_name,
       e.bank_account, l.days_worked, l.days_in_period,
       l.basic, l.earnings, l.gross, l.deductions, l.advance_deduction, l.net, l.line_id
  FROM erp_payroll_lines l
  JOIN erp_payroll_runs r ON r.run_id = l.run_id
  JOIN erp_employees e    ON e.emp_id = l.emp_id
  LEFT JOIN erp_departments d ON d.dept_id = e.dept_id
 WHERE l.run_id = :P_RUN AND l.emp_id = :P_EMP;

-- Q_ITEMS: ربط بالرأس على line_id. حصة صاحب العمل لا تظهر للموظف عادة (استبعدها بشرط kind <> 'EMPLOYER').
SELECT i.line_id,
       CASE i.kind WHEN 'BASIC' THEN 'استحقاق' WHEN 'EARNING' THEN 'استحقاق' ELSE 'استقطاع' END AS side,
       i.description, i.amount
  FROM erp_payroll_items i
  JOIN erp_payroll_lines l ON l.line_id = i.line_id
 WHERE l.run_id = :P_RUN AND l.emp_id = :P_EMP AND i.kind <> 'EMPLOYER'
 ORDER BY CASE i.kind WHEN 'BASIC' THEN 1 WHEN 'EARNING' THEN 2 WHEN 'DEDUCTION' THEN 3 ELSE 4 END, i.item_id;
