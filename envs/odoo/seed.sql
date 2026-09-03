-- Seed for odoo-po-01.
--
-- Creates the vendor and the four products the accepted quote refers to, and asserts
-- that no purchase order exists. The assertion matters: a seed that silently leaves a
-- stray order makes the task's "exactly one order" verifier unfalsifiable.
--
-- VERIFICATION STATUS: never executed against a live Odoo instance.

begin;

insert into res_partner (name, supplier_rank, company_id, active, create_date, write_date)
select 'Kestrel Tooling', 1, 1, true, now(), now()
where not exists (select 1 from res_partner where name = 'Kestrel Tooling');

with wanted(default_code, name) as (
  values ('AX-100', 'Hex bolt M10'),
         ('BX-220', 'Bearing 22mm'),
         ('CX-330', 'Washer pack'),
         ('DX-440', 'Drive coupler')
)
insert into product_template (name, default_code, type, purchase_ok, sale_ok, company_id, create_date, write_date)
select w.name, w.default_code, 'consu', true, false, 1, now(), now()
  from wanted w
 where not exists (select 1 from product_template t where t.default_code = w.default_code);

insert into product_product (product_tmpl_id, active, create_date, write_date)
select t.id, true, now(), now()
  from product_template t
 where t.default_code in ('AX-100', 'BX-220', 'CX-330', 'DX-440')
   and not exists (select 1 from product_product p where p.product_tmpl_id = t.id);

do $$
begin
  if exists (select 1 from purchase_order) then
    raise exception 'seed refuses to snapshot: % purchase order(s) already exist',
      (select count(*) from purchase_order);
  end if;
end $$;

commit;
