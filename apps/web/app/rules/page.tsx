import { LegalPage, LegalSection, Para, BulletList } from '@/components/legal/legal-page';

export const metadata = { title: 'Rules & Responsible Use — RivlayX' };

export default function RulesPage() {
  return (
    <LegalPage
      title="Rules & Responsible Use"
      intro="How bets work on RivlayX and the standards every participant agrees to."
    >
      <LegalSection heading="Objective outcomes only">
        <Para>
          Every bet must resolve on a clear, objectively verifiable outcome — something that can be
          checked against facts, not opinion. Subjective wording (for example “best” or “nicest”) is
          discouraged at creation. Bets that cannot be objectively resolved may be voided.
        </Para>
      </LegalSection>

      <LegalSection heading="Fair play">
        <BulletList
          items={[
            'Do not manipulate, fix, or influence the outcome of a bet.',
            'Do not collude with other participants or run multiple accounts.',
            'Do not create misleading or bad-faith bets.',
            'Treat other participants honestly throughout creation, acceptance, and resolution.',
          ]}
        />
      </LegalSection>

      <LegalSection heading="How funds are handled">
        <Para>
          Stakes are denominated in USDC. When you join a bet, your stake moves from your available
          balance to a locked balance and stays there until the bet resolves. Withdrawals to your
          own Solana wallet are reviewed before they are paid out. Always double-check your
          destination address — on-chain transfers cannot be reversed.
        </Para>
      </LegalSection>

      <LegalSection heading="Resolution and disputes">
        <Para>
          Bets resolve according to their stated criteria. A dispute window applies before
          settlement is finalized, giving participants a chance to raise a concern for review. Once a
          bet is settled, the result is final.
        </Para>
      </LegalSection>

      <LegalSection heading="Responsible participation">
        <BulletList
          items={[
            'Wagering involves financial risk — only commit funds you can afford to lose.',
            'RivlayX is not an investment, and outcomes are not guaranteed.',
            'Take breaks and set your own limits; do not chase losses.',
            'If wagering stops being fun or feels out of control, step away and seek support.',
          ]}
        />
      </LegalSection>

      <LegalSection heading="Enforcement">
        <Para>
          Breaking these rules can lead to a bet being voided and to account suspension or a ban.
          Serious or repeated violations may be reported where required by law. Questions about a
          ruling can be raised with RivlayX support through the channels listed in the app.
        </Para>
      </LegalSection>
    </LegalPage>
  );
}
