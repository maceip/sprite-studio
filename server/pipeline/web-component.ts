// Web Component Generator for UI Sprite Sheets & Animated Sprites
// Generates self-contained, zero-dependency Custom Elements with reactive attributes & Shadow DOM.

export interface WebComponentConfig {
  tag: string;
  className: string;
  sheetUrl: string;
  bannerUrl?: string;
  dialGrid: {
    cellWidth: number;
    cellHeight: number;
    cols: number;
    rows: number;
    totalDials: number;
  };
}

export class WebComponentGenerator {
  /**
   * Generates a fully-wired, standard Custom Element JavaScript module
   * for UI components like the Happy Meter.
   */
  static generateHappyMeterComponent(config?: Partial<WebComponentConfig>): string {
    const tag = config?.tag ?? "happy-meter";
    const className = config?.className ?? "HappyMeterElement";
    const sheetUrl = config?.sheetUrl ?? "/assets/ui_meter_sheet.png";
    const bannerUrl = config?.bannerUrl ?? "/assets/happy_meter_banner.png";
    const cellW = config?.dialGrid?.cellWidth ?? 114;
    const cellH = config?.dialGrid?.cellHeight ?? 114;
    const cols = config?.dialGrid?.cols ?? 7;

    return `// Auto-generated Web Component: <${tag}>
// Zero dependencies. Supports attributes: value (0-100), time ("00:00"-"23:59"), state ("active"|"warning"|"idle")

export class ${className} extends HTMLElement {
  static get observedAttributes() {
    return ['value', 'time', 'state', 'label'];
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue !== newValue) {
      this.updateState();
    }
  }

  get value() {
    return Math.min(100, Math.max(0, Number(this.getAttribute('value') || 0)));
  }

  set value(v) {
    this.setAttribute('value', String(v));
  }

  get time() {
    return this.getAttribute('time') || '12:00';
  }

  set time(t) {
    this.setAttribute('time', t);
  }

  get state() {
    return this.getAttribute('state') || 'idle';
  }

  set state(s) {
    this.setAttribute('state', s);
  }

  getDialCoordinates() {
    const parts = this.time.split(':');
    const hours = parseInt(parts[0], 10);
    const validHour = isNaN(hours) ? 12 : Math.min(23, Math.max(0, hours));

    const col = validHour % ${cols};
    const row = Math.floor(validHour / ${cols});

    return {
      x: col * ${cellW},
      y: row * ${cellH}
    };
  }

  updateState() {
    if (!this.shadowRoot) return;
    const coords = this.getDialCoordinates();
    const dialEl = this.shadowRoot.querySelector('.dial-sun-moon');
    const fillEl = this.shadowRoot.querySelector('.meter-fill');
    const valText = this.shadowRoot.querySelector('.meter-val-text');

    if (dialEl) {
      dialEl.style.backgroundPosition = \`-\${coords.x}px -\${coords.y}px\`;
    }
    if (fillEl) {
      fillEl.style.width = \`\${this.value}%\`;
    }
    if (valText) {
      valText.textContent = \`\${Math.round(this.value)}%\`;
    }
  }

  render() {
    const coords = this.getDialCoordinates();

    this.shadowRoot.innerHTML = \`
      <style>
        :host {
          display: inline-block;
          user-select: none;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }

        .meter-wrapper {
          position: relative;
          width: 480px;
          height: 96px;
          background-image: url('\${${JSON.stringify(bannerUrl)}}');
          background-size: contain;
          background-repeat: no-repeat;
          background-position: center;
          display: flex;
          align-items: center;
          filter: drop-shadow(0 6px 16px rgba(0,0,0,0.25));
        }

        /* Circular celestial dial window */
        .dial-viewport {
          position: absolute;
          left: 18px;
          top: 10px;
          width: 76px;
          height: 76px;
          border-radius: 50%;
          overflow: hidden;
          box-shadow: inset 0 2px 6px rgba(0,0,0,0.4);
          background: #111;
        }

        .dial-sun-moon {
          width: \${${cols * cellW}}px;
          height: \${${4 * cellH}}px;
          background-image: url('\${${JSON.stringify(sheetUrl)}}');
          background-repeat: no-repeat;
          background-position: -\${coords.x}px -\${coords.y}px;
          transform: scale(0.666);
          transform-origin: top left;
          transition: background-position 0.4s cubic-bezier(0.4, 0, 0.2, 1);
        }

        /* Progress track inside banner */
        .progress-track {
          position: absolute;
          left: 135px;
          top: 48px;
          width: 200px;
          height: 18px;
          background: rgba(15, 23, 42, 0.6);
          border-radius: 9px;
          overflow: hidden;
          border: 1px solid rgba(255,255,255,0.15);
        }

        .meter-fill {
          height: 100%;
          width: \${this.value}%;
          background: linear-gradient(90deg, #38bdf8, #818cf8 50%, #ec4899 100%);
          border-radius: 9px;
          transition: width 0.35s ease;
          box-shadow: 0 0 12px rgba(236, 72, 153, 0.5);
        }

        .meter-val-text {
          position: absolute;
          left: 345px;
          top: 47px;
          font-size: 13px;
          font-weight: 700;
          color: #f8fafc;
          text-shadow: 0 1px 3px rgba(0,0,0,0.8);
        }
      </style>

      <div class="meter-wrapper" role="progressbar" aria-valuenow="\${this.value}" aria-valuemin="0" aria-valuemax="100">
        <div class="dial-viewport" title="Time: \${this.time}">
          <div class="dial-sun-moon"></div>
        </div>
        <div class="progress-track">
          <div class="meter-fill"></div>
        </div>
        <span class="meter-val-text">\${Math.round(this.value)}%</span>
      </div>
    \`;
  }
}

if (!customElements.get('${tag}')) {
  customElements.define('${tag}', ${className});
}
`;
  }

  /**
   * Generates a reusable <sprite-actor> web component for multi-directional sprite animations.
   */
  static generateSpriteActorComponent(): string {
    return `// Auto-generated Web Component: <sprite-actor>
// Zero dependencies. Supports attributes: src, frames, fps, direction, playing

export class SpriteActorElement extends HTMLElement {
  static get observedAttributes() {
    return ['src', 'frames', 'fps', 'direction', 'playing', 'flip'];
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.frameIndex = 0;
    this.timer = null;
  }

  connectedCallback() {
    this.render();
    this.startLoop();
  }

  disconnectedCallback() {
    this.stopLoop();
  }

  attributeChangedCallback(name, oldVal, newVal) {
    if (oldVal !== newVal) {
      this.render();
      if (name === 'fps' || name === 'playing') {
        this.startLoop();
      }
    }
  }

  get frames() {
    return Math.max(1, parseInt(this.getAttribute('frames') || '8', 10));
  }

  get fps() {
    return Math.max(1, parseInt(this.getAttribute('fps') || '12', 10));
  }

  get isPlaying() {
    return this.getAttribute('playing') !== 'false';
  }

  startLoop() {
    this.stopLoop();
    if (!this.isPlaying) return;
    this.timer = setInterval(() => {
      this.frameIndex = (this.frameIndex + 1) % this.frames;
      const sheet = this.shadowRoot.querySelector('.actor-sheet');
      if (sheet) {
        sheet.style.transform = \`translateX(-\${this.frameIndex * 128}px)\`;
      }
    }, 1000 / this.fps);
  }

  stopLoop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  render() {
    const src = this.getAttribute('src') || '';
    const flip = this.getAttribute('flip') === 'true';

    this.shadowRoot.innerHTML = \`
      <style>
        :host {
          display: inline-block;
          width: 128px;
          height: 128px;
          overflow: hidden;
          position: relative;
          image-rendering: pixelated;
        }
        .actor-viewport {
          width: 128px;
          height: 128px;
          overflow: hidden;
          position: relative;
          transform: \${flip ? 'scaleX(-1)' : 'none'};
        }
        .actor-sheet {
          display: flex;
          position: absolute;
          top: 0;
          left: 0;
          height: 128px;
          will-change: transform;
        }
        .actor-sheet img {
          width: auto;
          height: 128px;
          display: block;
        }
      </style>
      <div class="actor-viewport">
        <div class="actor-sheet">
          <img src="\${src}" alt="Sprite Sheet" />
        </div>
      </div>
    \`;
  }
}

if (!customElements.get('sprite-actor')) {
  customElements.define('sprite-actor', SpriteActorElement);
}
`;
  }
}
