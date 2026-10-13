import { FAQ } from '../content/faq';

export function Faq() {
  return (
    <section class="section" id="faq">
      <h2>Vanity address FAQ</h2>
      <div class="faq">
        {FAQ.map((f, i) => (
          <details key={f.q} open={i === 0}>
            <summary>{f.q}</summary>
            <p>{f.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
