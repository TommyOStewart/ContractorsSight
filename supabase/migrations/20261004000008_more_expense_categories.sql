-- More expense categories for the tax view (mirrors EXPENSE_CATEGORIES in packages/shared).
alter type public.expense_category add value 'subcontractors' after 'materials';
alter type public.expense_category add value 'equipment_rental' after 'tools_equipment';
alter type public.expense_category add value 'permits_licenses' after 'supplies';
alter type public.expense_category add value 'insurance' after 'permits_licenses';
alter type public.expense_category add value 'advertising' after 'phone_software';
alter type public.expense_category add value 'office' after 'advertising';
alter type public.expense_category add value 'meals' after 'office';
alter type public.expense_category add value 'disposal' after 'meals';
alter type public.expense_category add value 'training' after 'disposal';
alter type public.expense_category add value 'bank_fees' after 'training';
