import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useSession } from '../../auth/SessionProvider';
import { supabase } from '../../lib/supabase';
import { BigButton, Card, colors, Display, Field, IconButton, Message, Screen, SecondaryButton, Small, Strong, TextButton } from '../../ui';

/** What prints at the top of every quote and invoice the company sends. */
interface CompanyDetails {
  name: string;
  phone: string;
  email: string;
  address: string;
  licenseNumber: string;
}

export default function AccountScreen() {
  const { session, memberships, signOut, refreshMemberships } = useSession();
  const company = memberships[0]!;
  const canEdit = company.role === 'owner' || company.role === 'admin';
  const [details, setDetails] = useState<CompanyDetails | null>(null);
  const [draft, setDraft] = useState<CompanyDetails | null>(null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    void supabase
      .from('organizations')
      .select('name, phone, email, address, license_number')
      .eq('id', company.orgId)
      .single()
      .then(({ data }) => {
        if (data)
          setDetails({
            name: data.name,
            phone: data.phone ?? '',
            email: data.email ?? '',
            address: data.address ?? '',
            licenseNumber: data.license_number ?? '',
          });
      });
  }, [company.orgId]);

  async function save() {
    if (!draft) return;
    if (!draft.name.trim()) {
      setProblem('Enter your company name.');
      return;
    }
    setSaving(true);
    // Blank fields are stored as empty (null), so they're left off quotes and invoices.
    const blank = (v: string) => v.trim() || null;
    const { error } = await supabase
      .from('organizations')
      .update({
        name: draft.name.trim(),
        phone: blank(draft.phone),
        email: blank(draft.email),
        address: blank(draft.address),
        license_number: blank(draft.licenseNumber),
      })
      .eq('id', company.orgId);
    setSaving(false);
    if (error) {
      setProblem("Couldn't save. Check your connection and try again.");
      return;
    }
    setDetails(draft);
    setDraft(null);
    setProblem(null);
    if (draft.name.trim() !== company.orgName) await refreshMemberships();
  }

  const set = (key: keyof CompanyDetails) => (value: string) => setDraft((d) => (d ? { ...d, [key]: value } : d));
  const contact = details ? [details.address, details.phone, details.email, details.licenseNumber && `License #${details.licenseNumber}`].filter(Boolean) : [];

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Display size={30}>Account</Display>
        <IconButton icon="x" label="Close" onPress={() => router.back()} />
      </View>
      {draft ? (
        <Card tone="accent" style={{ gap: 12 }}>
          <Strong>Company details</Strong>
          <Small>These print at the top of every quote and invoice you send.</Small>
          <Field label="Company name" value={draft.name} onChangeText={set('name')} autoCapitalize="words" />
          <Field label="Phone" value={draft.phone} onChangeText={set('phone')} keyboardType="phone-pad" autoComplete="tel" />
          <Field label="Email" value={draft.email} onChangeText={set('email')} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
          <Field
            label="Mailing address"
            value={draft.address}
            onChangeText={set('address')}
            multiline
            placeholder={'37 Main St\nSpringfield, MA 01101'}
          />
          <Field label="License number" value={draft.licenseNumber} onChangeText={set('licenseNumber')} autoCapitalize="characters" />
          <Message text={problem} tone="error" />
          <BigButton title="Save" onPress={() => void save()} busy={saving} />
          <TextButton title="Cancel" onPress={() => setDraft(null)} />
        </Card>
      ) : (
        <Card onPress={canEdit && details ? () => setDraft(details) : undefined}>
          <Small color={colors.muted}>Company</Small>
          <Strong>{company.orgName}</Strong>
          {contact.map((line) => (
            <Small key={line}>{line}</Small>
          ))}
          {canEdit && details && contact.length === 0 && (
            <Small color={colors.accent}>Add your phone, email and address so they show on your quotes and invoices.</Small>
          )}
          <Small color={colors.muted}>
            You're the {company.role}
            {canEdit ? ' · tap to edit' : ''}
          </Small>
        </Card>
      )}
      <Card>
        <Small color={colors.muted}>Signed in as</Small>
        <Strong>{session?.user.email}</Strong>
      </Card>
      <SecondaryButton title="Business dashboard" icon="bar-chart-2" onPress={() => router.replace('/business')} />
      <SecondaryButton title="Sign out" icon="log-out" onPress={signOut} />
    </Screen>
  );
}
