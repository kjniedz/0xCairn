/** "Why this is safe" in one glance: your half stays, we find an offset, you combine. */
export function SplitDiagram() {
  return (
    <div class="diagram" aria-label="How split-key mining keeps your key private">
      <div class="dg-col you">
        <div class="dg-where">Your browser</div>
        <div class="dg-box">
          <span class="dg-k">private half</span>
          <span class="dg-v mono">a</span>
        </div>
        <div class="dg-note">generated here, never sent</div>
      </div>
      <div class="dg-arrow" aria-hidden="true">
        <span>public key A = a·G</span>
        <i>→</i>
      </div>
      <div class="dg-col us">
        <div class="dg-where">Our GPUs</div>
        <div class="dg-box">
          <span class="dg-k">search</span>
          <span class="dg-v mono">A + d·G</span>
        </div>
        <div class="dg-note">finds an offset d whose address matches</div>
      </div>
      <div class="dg-arrow" aria-hidden="true">
        <span>offset d</span>
        <i>→</i>
      </div>
      <div class="dg-col you">
        <div class="dg-where">Your browser</div>
        <div class="dg-box">
          <span class="dg-k">final key</span>
          <span class="dg-v mono">a + d</span>
        </div>
        <div class="dg-note">only you ever hold it</div>
      </div>
    </div>
  );
}
