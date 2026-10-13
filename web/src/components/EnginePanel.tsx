import type { SearchSnapshot } from '../engine/types';
import type { SearchController } from '../engine/search';
import { formatRate } from '../lib/pattern';

export function EnginePanel({ snap, controller }: { snap: SearchSnapshot; controller: SearchController }) {
  const { cpu, gpu } = snap.engines;
  const busy = snap.status === 'running' || snap.status === 'starting';
  const benching = controller.isBenching;
  const cpuRate = busy ? cpu.liveRate : cpu.benchRate != null ? (cpu.benchRate / Math.max(1, controller.maxWorkers)) * cpu.workers : null;
  const gpuRate = gpu.available && gpu.enabled ? (busy ? gpu.liveRate : gpu.benchRate) : null;
  const total = (cpuRate ?? 0) + (gpuRate ?? 0);

  return (
    <div class="engines">
      <div class="engines-total">
        <div class="big">
          {cpuRate == null ? (cpu.ready ? 'benchmarking…' : 'loading…') : formatRate(total)}
          <small>{busy ? 'live, all engines' : 'estimated, all engines'}</small>
        </div>
        <button type="button" class="btn xs ghost" disabled={busy || benching || !cpu.ready} onClick={() => controller.rebench()} title="Run a 3-second benchmark and refresh the estimates">
          {benching ? 'Benchmarking…' : 'Benchmark'}
        </button>
      </div>

      <div class="engine">
        <div>
          <div class="name">CPU</div>
          <div class="sub">{cpu.ready ? `${cpu.workers} of ${controller.maxWorkers} cores, WebAssembly workers` : 'loading kernel…'}</div>
        </div>
        <div class="ctl">
          <span class={`rate ${cpuRate == null ? 'muted' : ''}`}>{cpuRate == null ? '…' : formatRate(cpuRate)}</span>
          <div class="stepper" aria-label="CPU workers">
            <button type="button" disabled={busy || cpu.workers <= 1} onClick={() => controller.setWorkers(cpu.workers - 1)} aria-label="Fewer workers">
              −
            </button>
            <span>{cpu.workers}</span>
            <button type="button" disabled={busy || cpu.workers >= controller.maxWorkers} onClick={() => controller.setWorkers(cpu.workers + 1)} aria-label="More workers">
              +
            </button>
          </div>
        </div>
      </div>

      <div class={`engine ${gpu.available && gpu.enabled ? '' : 'off'}`}>
        <div>
          <div class="name">GPU</div>
          {(() => {
            const sub = !gpu.supported
              ? 'WebGPU not available in this browser'
              : gpu.checking
                ? 'compiling and self-testing…'
                : gpu.available
                  ? gpu.description || ''
                  : gpu.error
                    ? gpu.error.length > 80
                      ? gpu.error.slice(0, 80) + '…'
                      : gpu.error
                    : 'unavailable';
            return sub ? <div class="sub">{sub}</div> : null;
          })()}
        </div>
        <div class="ctl">
          <span class={`rate ${gpuRate == null ? 'muted' : ''}`}>{gpu.checking ? '…' : gpu.available ? (gpu.enabled ? (gpuRate != null ? formatRate(gpuRate) : '…') : 'off') : ''}</span>
          {gpu.available && (
            <label class="toggle" title="Use the GPU alongside the CPU workers">
              <input type="checkbox" checked={gpu.enabled} disabled={busy} onChange={(e) => controller.setGpuEnabled((e.target as HTMLInputElement).checked)} />
              <span class="sw" />
            </label>
          )}
        </div>
      </div>
    </div>
  );
}
