-- ============================================================================
-- 01d: نظام المقاهي — الطاولات وخيارات الأصناف (المقاسات والإضافات) وطلبات الطاولة المفتوحة.
-- **متكرر التشغيل (idempotent)**. يعمل فوق نقاط البيع القائمة: إغلاق الطلب يستدعي ERP_POS.SELL نفسها
-- (نفس ترحيل المخزون والتكلفة والقيد المحاسبي المختبَر) فلا تكرار لمنطق محاسبي، وإنما طبقة طلب يبقى مفتوحاً
-- يُضاف إليه بنود بمرور الوقت قبل تحويله إلى عملية بيع واحدة عند الدفع.
-- ============================================================================
SET DEFINE OFF

DECLARE
  FUNCTION has_tab (p_name VARCHAR2) RETURN BOOLEAN IS v NUMBER; BEGIN
    SELECT COUNT(*) INTO v FROM user_tables WHERE table_name = p_name; RETURN v > 0; END has_tab;
  FUNCTION has_col (p_tab VARCHAR2, p_col VARCHAR2) RETURN BOOLEAN IS v NUMBER; BEGIN
    SELECT COUNT(*) INTO v FROM user_tab_columns WHERE table_name = p_tab AND column_name = p_col; RETURN v > 0; END has_col;
  FUNCTION has_type (p_name VARCHAR2) RETURN BOOLEAN IS v NUMBER; BEGIN
    SELECT COUNT(*) INTO v FROM user_types WHERE type_name = p_name; RETURN v > 0; END has_type;
BEGIN
  IF NOT has_type('ERP_ID_TAB') THEN EXECUTE IMMEDIATE 'CREATE TYPE erp_id_tab AS TABLE OF NUMBER'; END IF;

  IF NOT has_col('ERP_ITEMS', 'STATION') THEN
    EXECUTE IMMEDIATE q'[ALTER TABLE erp_items ADD (station VARCHAR2(10) DEFAULT 'KITCHEN' NOT NULL
      CONSTRAINT erp_items_station_ck CHECK (station IN ('KITCHEN','BAR','NONE')))]';
  END IF;

  IF NOT has_tab('ERP_MODIFIER_GROUPS') THEN
    EXECUTE IMMEDIATE q'[CREATE TABLE erp_modifier_groups (
      group_id  NUMBER GENERATED ALWAYS AS IDENTITY CONSTRAINT erp_modifier_groups_pk PRIMARY KEY,
      name      VARCHAR2(80) NOT NULL,
      required  CHAR(1) DEFAULT 'N' NOT NULL CONSTRAINT erp_modifier_groups_req_ck CHECK (required IN ('Y','N')),
      multi     CHAR(1) DEFAULT 'N' NOT NULL CONSTRAINT erp_modifier_groups_multi_ck CHECK (multi IN ('Y','N')),
      active    CHAR(1) DEFAULT 'Y' NOT NULL CONSTRAINT erp_modifier_groups_active_ck CHECK (active IN ('Y','N'))
    )]';
  END IF;
  IF NOT has_tab('ERP_MODIFIER_OPTIONS') THEN
    EXECUTE IMMEDIATE q'[CREATE TABLE erp_modifier_options (
      option_id    NUMBER GENERATED ALWAYS AS IDENTITY CONSTRAINT erp_modifier_options_pk PRIMARY KEY,
      group_id     NUMBER NOT NULL CONSTRAINT erp_modifier_options_grp_fk REFERENCES erp_modifier_groups (group_id),
      name         VARCHAR2(80) NOT NULL,
      price_delta  NUMBER(18,2) DEFAULT 0 NOT NULL,
      active       CHAR(1) DEFAULT 'Y' NOT NULL CONSTRAINT erp_modifier_options_active_ck CHECK (active IN ('Y','N'))
    )]';
    EXECUTE IMMEDIATE 'CREATE INDEX erp_modifier_options_grp_ix ON erp_modifier_options (group_id)';
  END IF;
  IF NOT has_tab('ERP_ITEM_MODIFIER_GROUPS') THEN
    EXECUTE IMMEDIATE q'[CREATE TABLE erp_item_modifier_groups (
      item_id   NUMBER NOT NULL CONSTRAINT erp_item_mod_grp_item_fk REFERENCES erp_items (item_id),
      group_id  NUMBER NOT NULL CONSTRAINT erp_item_mod_grp_grp_fk REFERENCES erp_modifier_groups (group_id),
      seq       NUMBER DEFAULT 1 NOT NULL,
      CONSTRAINT erp_item_modifier_groups_pk PRIMARY KEY (item_id, group_id)
    )]';
  END IF;

  IF NOT has_tab('ERP_CAFE_AREAS') THEN
    EXECUTE IMMEDIATE q'[CREATE TABLE erp_cafe_areas (
      area_id  NUMBER GENERATED ALWAYS AS IDENTITY CONSTRAINT erp_cafe_areas_pk PRIMARY KEY,
      reg_id   NUMBER NOT NULL CONSTRAINT erp_cafe_areas_reg_fk REFERENCES erp_pos_registers (reg_id),
      name     VARCHAR2(60) NOT NULL,
      CONSTRAINT erp_cafe_areas_uk UNIQUE (reg_id, name)
    )]';
  END IF;
  IF NOT has_tab('ERP_CAFE_TABLES') THEN
    EXECUTE IMMEDIATE q'[CREATE TABLE erp_cafe_tables (
      table_id  NUMBER GENERATED ALWAYS AS IDENTITY CONSTRAINT erp_cafe_tables_pk PRIMARY KEY,
      reg_id    NUMBER NOT NULL CONSTRAINT erp_cafe_tables_reg_fk REFERENCES erp_pos_registers (reg_id),
      area_id   NUMBER CONSTRAINT erp_cafe_tables_area_fk REFERENCES erp_cafe_areas (area_id),
      code      VARCHAR2(12) NOT NULL,
      name      VARCHAR2(80) NOT NULL,
      seats     NUMBER(3) DEFAULT 4 NOT NULL,
      active    CHAR(1) DEFAULT 'Y' NOT NULL CONSTRAINT erp_cafe_tables_active_ck CHECK (active IN ('Y','N')),
      CONSTRAINT erp_cafe_tables_code_uk UNIQUE (reg_id, code)
    )]';
  END IF;
  IF NOT has_tab('ERP_CAFE_ORDERS') THEN
    EXECUTE IMMEDIATE q'[CREATE TABLE erp_cafe_orders (
      order_id     NUMBER GENERATED ALWAYS AS IDENTITY CONSTRAINT erp_cafe_orders_pk PRIMARY KEY,
      table_id     NUMBER CONSTRAINT erp_cafe_orders_table_fk REFERENCES erp_cafe_tables (table_id),
      reg_id       NUMBER NOT NULL CONSTRAINT erp_cafe_orders_reg_fk REFERENCES erp_pos_registers (reg_id),
      shift_id     NUMBER NOT NULL CONSTRAINT erp_cafe_orders_shift_fk REFERENCES erp_pos_shifts (shift_id),
      status       VARCHAR2(10) DEFAULT 'OPEN' NOT NULL CONSTRAINT erp_cafe_orders_status_ck CHECK (status IN ('OPEN','CLOSED','CANCELLED')),
      guests       NUMBER(3),
      waiter       VARCHAR2(128) DEFAULT SYS_CONTEXT('USERENV','SESSION_USER') NOT NULL,
      note         VARCHAR2(300),
      opened_at    TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
      closed_at    TIMESTAMP,
      pos_sale_id  NUMBER CONSTRAINT erp_cafe_orders_sale_fk REFERENCES erp_pos_sales (sale_id)
    )]';
    -- طاولة واحدة لا يكون لها إلا طلب مفتوح واحد (NULL = سفري/كاونتر: يُستثنى تلقائياً فيُسمح بعدة طلبات سفرية مفتوحة معاً)
    EXECUTE IMMEDIATE q'[CREATE UNIQUE INDEX erp_cafe_orders_table_open_uk ON erp_cafe_orders (CASE WHEN status = 'OPEN' THEN table_id END)]';
    EXECUTE IMMEDIATE 'CREATE INDEX erp_cafe_orders_shift_ix ON erp_cafe_orders (shift_id)';
  END IF;
  IF NOT has_tab('ERP_CAFE_ORDER_LINES') THEN
    EXECUTE IMMEDIATE q'[CREATE TABLE erp_cafe_order_lines (
      line_id     NUMBER GENERATED ALWAYS AS IDENTITY CONSTRAINT erp_cafe_lines_pk PRIMARY KEY,
      order_id    NUMBER NOT NULL CONSTRAINT erp_cafe_lines_order_fk REFERENCES erp_cafe_orders (order_id),
      item_id     NUMBER NOT NULL CONSTRAINT erp_cafe_lines_item_fk REFERENCES erp_items (item_id),
      qty         NUMBER(18,3) DEFAULT 1 NOT NULL CONSTRAINT erp_cafe_lines_qty_ck CHECK (qty > 0),
      base_price  NUMBER(18,2) NOT NULL CONSTRAINT erp_cafe_lines_price_ck CHECK (base_price >= 0),
      mod_delta   NUMBER(18,2) DEFAULT 0 NOT NULL,
      mod_text    VARCHAR2(400),
      note        VARCHAR2(200),
      station     VARCHAR2(10) DEFAULT 'KITCHEN' NOT NULL CONSTRAINT erp_cafe_lines_station_ck CHECK (station IN ('KITCHEN','BAR','NONE')),
      status      VARCHAR2(10) DEFAULT 'NEW' NOT NULL CONSTRAINT erp_cafe_lines_status_ck CHECK (status IN ('NEW','SENT','SERVED','CANCELLED')),
      sent_at     TIMESTAMP,
      served_at   TIMESTAMP,
      created_at  TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
    )]';
    EXECUTE IMMEDIATE 'CREATE INDEX erp_cafe_lines_order_ix ON erp_cafe_order_lines (order_id)';
    EXECUTE IMMEDIATE 'CREATE INDEX erp_cafe_lines_status_ix ON erp_cafe_order_lines (status)';
  END IF;

  EXECUTE IMMEDIATE q'[CREATE OR REPLACE VIEW v_erp_cafe_tables AS
    SELECT t.table_id, t.reg_id, t.area_id, a.name AS area_name, t.code, t.name, t.seats, t.active,
           o.order_id AS open_order_id, o.opened_at AS open_since, o.guests, o.waiter,
           (SELECT COUNT(*) FROM erp_cafe_order_lines l WHERE l.order_id = o.order_id AND l.status <> 'CANCELLED') AS line_count,
           (SELECT NVL(SUM(l.qty * (l.base_price + l.mod_delta)), 0) FROM erp_cafe_order_lines l WHERE l.order_id = o.order_id AND l.status <> 'CANCELLED') AS running_total
      FROM erp_cafe_tables t LEFT JOIN erp_cafe_areas a ON a.area_id = t.area_id
      LEFT JOIN erp_cafe_orders o ON o.table_id = t.table_id AND o.status = 'OPEN']';
END;
/
