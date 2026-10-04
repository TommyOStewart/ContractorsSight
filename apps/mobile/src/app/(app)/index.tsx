import { useSession } from '../../auth/SessionProvider';
import { Body, Button, Screen, Title } from '../../ui';

// Home. Capture, review, and job lists will land here in the next PRs.
export default function HomeScreen() {
  const { session, memberships, signOut } = useSession();
  const company = memberships[0];

  return (
    <Screen>
      <Title>{company?.orgName}</Title>
      <Body muted>
        Signed in as {session?.user.email} ({company?.role})
      </Body>
      <Body>You're set up. Voice, photo, and text captures are next.</Body>
      <Button variant="link" title="Sign out" onPress={signOut} />
    </Screen>
  );
}
