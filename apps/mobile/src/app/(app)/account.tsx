import { router } from 'expo-router';
import { View } from 'react-native';
import { useSession } from '../../auth/SessionProvider';
import { Card, colors, Display, IconButton, Screen, SecondaryButton, Small, Strong } from '../../ui';

export default function AccountScreen() {
  const { session, memberships, signOut } = useSession();
  const company = memberships[0]!;
  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Display size={30}>Account</Display>
        <IconButton icon="x" label="Close" onPress={() => router.back()} />
      </View>
      <Card>
        <Small color={colors.muted}>Company</Small>
        <Strong>{company.orgName}</Strong>
        <Small>You're the {company.role}</Small>
      </Card>
      <Card>
        <Small color={colors.muted}>Signed in as</Small>
        <Strong>{session?.user.email}</Strong>
      </Card>
      <SecondaryButton title="Business dashboard" icon="bar-chart-2" onPress={() => router.replace('/business')} />
      <SecondaryButton title="Sign out" icon="log-out" onPress={signOut} />
    </Screen>
  );
}
