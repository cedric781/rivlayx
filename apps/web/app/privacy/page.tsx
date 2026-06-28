import { LegalPage, LegalSection, Para, BulletList } from '@/components/legal/legal-page';

export const metadata = { title: 'Privacy Policy — RivlayX' };

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      intro="This policy explains what information RivlayX handles and how it is used."
    >
      <LegalSection heading="Information we collect">
        <BulletList
          items={[
            'Account information provided through our authentication provider, such as an email address or linked sign-in.',
            'Wallet addresses you link for deposits and withdrawals.',
            'Activity on the platform, including bets you create, accept, and resolve, and your USDC transactions.',
            'Basic technical data needed to operate and secure the service.',
          ]}
        />
      </LegalSection>

      <LegalSection heading="How we use information">
        <Para>
          We use this information to operate the platform, process deposits and withdrawals, resolve
          bets and disputes, maintain security and integrity, and meet legal and regulatory
          obligations.
        </Para>
      </LegalSection>

      <LegalSection heading="On-chain transactions are public">
        <Para>
          USDC deposits and withdrawals occur on the Solana blockchain. Transactions recorded on a
          public blockchain are visible to anyone and are outside RivlayX’s control. Do not treat
          on-chain activity or wallet addresses as private.
        </Para>
      </LegalSection>

      <LegalSection heading="Sharing">
        <Para>
          We share information with service providers who help us run the platform (such as our
          authentication and infrastructure providers), and where required by law or to protect the
          integrity of the service. We do not sell your personal information.
        </Para>
      </LegalSection>

      <LegalSection heading="Retention">
        <Para>
          We retain information for as long as needed to provide the service, resolve disputes,
          maintain records of financial activity, and comply with legal obligations.
        </Para>
      </LegalSection>

      <LegalSection heading="Your choices and contact">
        <Para>
          Depending on your jurisdiction, you may have rights to access, correct, or delete certain
          information. To make a request or ask a question, contact RivlayX support through the
          channels listed in the app.
        </Para>
      </LegalSection>
    </LegalPage>
  );
}
