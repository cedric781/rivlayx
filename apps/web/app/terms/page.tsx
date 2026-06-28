import { LegalPage, LegalSection, Para, BulletList } from '@/components/legal/legal-page';

export const metadata = { title: 'Terms of Service — RivlayX' };

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      intro="These terms describe how RivlayX works and the rules you agree to when you use it."
    >
      <LegalSection heading="What RivlayX is">
        <Para>
          RivlayX is a peer-to-peer platform for wagering on objectively verifiable outcomes. Users
          create bets with clear, measurable resolution criteria, and other users take the opposing
          side. Stakes are denominated in USDC. RivlayX is not a bookmaker and does not take a
          position in any bet.
        </Para>
      </LegalSection>

      <LegalSection heading="Eligibility">
        <Para>
          You must be of legal age in your jurisdiction and permitted by applicable local law to
          participate in wagering. You are responsible for ensuring your use of RivlayX is lawful
          where you live. RivlayX may restrict or decline access where required.
        </Para>
      </LegalSection>

      <LegalSection heading="Accounts and wallets">
        <Para>
          Access requires an account created through our authentication provider. You may link a
          Solana wallet for deposits and withdrawals. You are responsible for keeping your account
          and wallet credentials secure and for all activity that occurs under your account.
        </Para>
      </LegalSection>

      <LegalSection heading="Funds, stakes, and balances">
        <BulletList
          items={[
            'Deposits and withdrawals are made in USDC. Your balance is shown as available and locked amounts.',
            'When you create or accept a bet, the required stake is locked and cannot be spent elsewhere until the bet resolves.',
            'Withdrawals to your own wallet are reviewed before they are paid out, and on-chain transfers are irreversible once sent.',
            'You are responsible for providing a correct destination wallet address.',
          ]}
        />
      </LegalSection>

      <LegalSection heading="Bet resolution and disputes">
        <Para>
          Each bet resolves according to its stated criteria. A dispute window applies before
          settlement is finalized, during which a participant may raise a dispute for review. Once a
          bet is settled, the outcome is final.
        </Para>
      </LegalSection>

      <LegalSection heading="Fees">
        <Para>
          A creation fee may apply when you open a bet, and a settlement fee may apply when a bet is
          settled. Applicable fees are shown before you commit to an action.
        </Para>
      </LegalSection>

      <LegalSection heading="Acceptable use">
        <Para>
          You agree not to manipulate outcomes, collude with other users, operate multiple accounts,
          create bets on subjective or unverifiable outcomes, or use RivlayX for any unlawful
          purpose. Accounts that violate these rules may be suspended or banned. See the{' '}
          <a href="/rules" style={{ color: 'var(--rx-color-primary)' }}>
            responsible-use rules
          </a>{' '}
          for details.
        </Para>
      </LegalSection>

      <LegalSection heading="Disclaimers and limitation of liability">
        <Para>
          RivlayX is provided “as is” without warranties of any kind. Wagering carries financial
          risk, and you may lose your stake. To the maximum extent permitted by law, RivlayX is not
          liable for losses arising from your use of the platform. These provisions are a placeholder
          pending review by legal counsel.
        </Para>
      </LegalSection>

      <LegalSection heading="Changes and contact">
        <Para>
          We may update these terms as the product evolves; material changes will be reflected on
          this page. For questions, contact RivlayX support through the channels listed in the app.
        </Para>
      </LegalSection>
    </LegalPage>
  );
}
