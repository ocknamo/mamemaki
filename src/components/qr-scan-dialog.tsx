import { css, Show, signal, onCleanup, onMount } from "@kanabun/core";
import { qrToLightningAddress } from "../lib/qr";
import { ghostBtnStyles } from "./styles";

// `BarcodeDetector` is not yet in TypeScript's DOM lib; minimal shape here.
interface DetectedBarcode {
  rawValue: string;
}
type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => {
  detect(source: HTMLVideoElement): Promise<DetectedBarcode[]>;
};

const SCAN_INTERVAL_MS = 300;

const dialogStyles = css`
  position: fixed;
  inset: 0;
  z-index: 50;
  background: rgb(0 0 0 / 0.65);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;

  .scan-panel {
    background: var(--card);
    border-radius: 14px;
    padding: 0.9rem;
    width: 100%;
    max-width: 22rem;
    box-sizing: border-box;
  }
  h3 {
    margin: 0 0 0.6rem;
    font-size: 1rem;
  }
  video {
    display: block;
    width: 100%;
    aspect-ratio: 1;
    object-fit: cover;
    border-radius: 10px;
    background: #000;
  }
  .scan-hint {
    margin: 0.6rem 0 0;
    font-size: 0.82rem;
    color: var(--muted);
  }
  .scan-error {
    margin: 0.6rem 0 0;
    font-size: 0.82rem;
    color: var(--danger);
  }
  .scan-close {
    width: 100%;
    margin-top: 0.75rem;
  }
`;

export interface QrScanDialogProps {
  /** Called once with the scanned Lightning Address; the dialog stops itself. */
  onDetect: (address: string) => void;
  onClose: () => void;
}

/**
 * Camera QR scanner: reads a Lightning Address / LNURL-pay QR via
 * `getUserMedia` + `BarcodeDetector` (standard APIs only — unsupported
 * browsers get a message instead of a decoder-library fallback, per the
 * roadmap's minimal-dependency policy).
 */
export function QrScanDialog({ onDetect, onClose }: QrScanDialogProps) {
  const error = signal("");
  let video: HTMLVideoElement | null = null;
  let stream: MediaStream | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;
  let detecting = false;
  let stopped = false;

  function stop() {
    stopped = true;
    clearInterval(timer);
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
  }

  async function start() {
    const Detector = (globalThis as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
    if (!Detector) {
      error.set(
        "このブラウザはQRコード読み取り(BarcodeDetector)に対応していません。アドレスを直接入力してください",
      );
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      error.set("このブラウザではカメラを利用できません");
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
    } catch {
      error.set("カメラを起動できませんでした。カメラの使用を許可してください");
      return;
    }
    // The dialog may have been closed while awaiting the permission prompt.
    if (stopped || !video) {
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
      return;
    }
    video.srcObject = stream;
    try {
      await video.play();
    } catch {
      // Autoplay rejection is a non-issue for a muted playsInline video that
      // was opened from a tap; keep scanning rather than aborting on it.
    }
    const detector = new Detector({ formats: ["qr_code"] });
    timer = setInterval(() => {
      if (detecting || stopped || !video || video.readyState < 2) return;
      detecting = true;
      detector
        .detect(video)
        .then((codes) => {
          for (const code of codes) {
            const address = qrToLightningAddress(code.rawValue);
            if (address) {
              stop();
              onDetect(address);
              return;
            }
          }
          if (codes.length > 0) {
            error.set("対応していないQRコードです。Lightning Address / LNURL-pay のQRを読み取ってください");
          }
        })
        // Per-frame detection errors are transient; just try the next frame.
        .catch(() => {})
        .finally(() => {
          detecting = false;
        });
    }, SCAN_INTERVAL_MS);
  }

  onMount(() => void start());
  onCleanup(stop);

  return (
    <div class={`scan-overlay ${dialogStyles}`} role="dialog" aria-label="QRコードを読み取る">
      <div class="scan-panel">
        <h3>Scan QR</h3>
        <video ref={(el: Element) => (video = el as HTMLVideoElement)} muted playsInline></video>
        <Show
          when={() => error() !== ""}
          fallback={<p class="scan-hint">Lightning Address / LNURL-pay のQRコードをかざしてください</p>}
        >
          <p class="scan-error">{() => error()}</p>
        </Show>
        <button type="button" class={`ghost-btn scan-close ${ghostBtnStyles}`} onClick={onClose}>
          閉じる
        </button>
      </div>
    </div>
  );
}
