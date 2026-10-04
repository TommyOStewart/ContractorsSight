import { Platform, Share } from 'react-native';
import { supabase } from '../lib/supabase';

const CATEGORY: Record<string, string> = {
  materials: 'Materials',
  tools_equipment: 'Tools & equipment',
  vehicle: 'Vehicle',
  supplies: 'Shop supplies',
  phone_software: 'Phone & software',
  other: 'Other',
};

const cell = (v: string | number | null | undefined) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** The year's expenses as CSV for the accountant. Downloads on web; opens the share sheet on phones. */
export async function exportExpenses(orgId: string, orgName: string, year: number): Promise<number> {
  const { data, error } = await supabase
    .from('expenses')
    .select('spent_on, category, description, vendor_name, total_cents, receipt_attachment_id, supply_houses (name), jobs (title)')
    .eq('org_id', orgId)
    .gte('spent_on', `${year}-01-01`)
    .lte('spent_on', `${year}-12-31`)
    .order('spent_on');
  if (error) throw error;

  const rows = [
    ['Date', 'Category', 'Description', 'Vendor', 'Job', 'Amount', 'Receipt photo'],
    ...(data ?? []).map((e) => [
      e.spent_on,
      CATEGORY[e.category] ?? e.category,
      e.description,
      e.supply_houses?.name ?? e.vendor_name,
      e.jobs?.title,
      (Number(e.total_cents) / 100).toFixed(2),
      e.receipt_attachment_id ? 'yes' : 'no',
    ]),
  ];
  const csv = rows.map((r) => r.map(cell).join(',')).join('\n');
  const fileName = `${orgName.replace(/[^\w]+/g, '-')}-expenses-${year}.csv`;

  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  } else {
    await Share.share({ title: fileName, message: csv });
  }
  return rows.length - 1;
}
