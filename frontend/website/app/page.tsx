/**
 * @file page.tsx
 * @description auto fomo landing page.
 * @author Reborn1987
 */

import { Faq, Features, Hero, Holders, HowItWorks, SectionHead, SiteFooter, SiteHeader } from '@/components/site/Sections';
import { TryIt } from '@/components/site/TryIt';
import { Walkthrough } from '@/components/site/Walkthrough';

/** Landing page. */
export default function Home() {
  return (
    <>
      <SiteHeader />
      <main>
        <Hero />
        <section id="demo" className="mx-auto max-w-6xl px-5 py-24">
          <SectionHead eyebrow="Demo" title="From target to filled, on its own" sub="A limit buy, start to finish. Hover to pause, click a step to jump." />
          <Walkthrough />
        </section>
        <section className="mx-auto max-w-6xl px-5 pb-24">
          <SectionHead eyebrow="Try it" title="Drag it. The order type follows." sub="Below the live market cap buys the dip or stops a loss. Above it breaks out or takes profit." />
          <TryIt />
        </section>
        <Features />
        <HowItWorks />
        <Holders />
        <Faq />
      </main>
      <SiteFooter />
    </>
  );
}
