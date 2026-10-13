import type { SearchSnapshot } from '../engine/types';
import type { SearchController } from '../engine/search';
import { formatRate } from '../lib/pattern';

export function EnginePanel({ snap, controller }: { snap: SearchSnapshot; controller: SearchController }) {
  const { cpu, gpu } = snap.engines;
  const busy = snap.status === 'running' || snap.status === 'starting';
  const cpuRate = busy ? cpu.liveRate : cpu.benchRate != null ? (cpu.benchRate / Math.max(1, controller.maxWorkers)) * cpu.workers : null;
  return (
    <div>
      <div class="field">
        <span class="label">Engines</span>
      </div>
      <div class="engines">
        <div class="engine">
          <div>
            <div class="name">CPU · Web Workers</div>
            <div class="sub">
              {cpu.ready ? `${cpu.workers} of ${controller.maxWorkers} cores` : 'loading kernel…'}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span class={`rate ${cpuRate == null ? 'muted' : ''}`}>{cpuRate == null ? (cpu.ready ? 'benchmarking…' : '…') : formatRate(cpuRate)}</span>
            <div class="stepper" aria-label="CPU workers">
              <button type="button" disabled={busy || cpu.workers <= 1} onClick={() => controller.setWorkers(cpu.workers - 1)} aria-label="Fewer workers">
                −
              </button>
              <span>{cpu.workers}</span>
              <button
                type="button"
                disabled={busy || cpu.workers >= controller.maxWorkers}
                onClick={() => controller.setWorkers(cpu.workers + 1)}
                aria-label="More workers"
              >
                +
              </button>
            </div>
          </div>
        </div>

        <div class={`engine ${gpu.available && gpu.enabled ? '' : 'off'}`}>
          <div>
            <div class="name">GPU · WebGPU</div>
            <div class="sub">
              {!gpu.supported
                ? 'not available in this browser'
                : gpu.checking
                  ? 'compiling + self-testing…'
                  : gpu.available
                    ? gpu.description || 'ready'
                    : gpu.error
                      ? gpu.error.length > 70
                        ? gpu.error.slice(0, 70) + '…'
                        : gpu.error
                      : 'unavailable'}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span class={`rate ${gpu.available && gpu.enabled ? '' : 'muted'}`}>
              {gpu.available ? (busy && gpu.enabled ? formatRate(gpu.liveRate) : gpu.benchRate != null ? formatRate(gpu.benchRate) : '') : gpu.checking ? '…' : 'off'}
            </span>
            {gpu.available && (
              <label class="toggle" title="Use the GPU alongside the CPU workers">
                <input type="checkbox" checked={gpu.enabled} disabled={busy} onChange={(e) => controller.setGpuEnabled((e.target as HTMLInputElement).checked)} />
                <span class="sw" />
              </label>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
