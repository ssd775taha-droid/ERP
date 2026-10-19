-- كشف الرواتب الإجمالي لشهر. المعامل: :P_RUN (رقم الكشف، إلزامي)
SELECT e.code AS emp_code, e.name AS emp_name, d.name AS dept_name,
       l.days_worked, l.days_in_period, l.basic, l.earnings, l.gross,
       l.deductions, l.advance_deduction, l.net, l.employer_cost
  FROM erp_payroll_lines l
  JOIN erp_employees e   ON e.emp_id = l.emp_id
  LEFT JOIN erp_departments d ON d.dept_id = e.dept_id
 WHERE l.run_id = :P_RUN
 ORDER BY d.name, e.code;
-- تجميع بالقسم (رأس: اسم القسم) وملخصات Sum لكل عمود مالي لكل قسم وللتقرير.
-- أعلى التقرير: الشهر والحالة من v_erp_payroll_summary حيث run_id = :P_RUN.
