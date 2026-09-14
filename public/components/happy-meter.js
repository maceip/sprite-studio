// Web Component: <happy-meter>
// Self-contained Custom Element generated from sprite sheet
// Supports reactive attributes: value (0-100), time ("00:00"-"23:59"), state ("active"|"warning"|"idle")

export class HappyMeterElement extends HTMLElement {
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

    const col = validHour % 7;
    const row = Math.floor(validHour / 7);

    return {
      x: col * 114,
      y: row * 114,
    };
  }

  updateState() {
    if (!this.shadowRoot) return;
    const coords = this.getDialCoordinates();
    const dialEl = this.shadowRoot.querySelector('.dial-sun-moon');
    const fillEl = this.shadowRoot.querySelector('.meter-fill');
    const valText = this.shadowRoot.querySelector('.meter-val-text');

    if (dialEl) {
      dialEl.style.backgroundPosition = `-${coords.x}px -${coords.y}px`;
    }
    if (fillEl) {
      // Map 0-100% value to fill width (max track width is 270px)
      fillEl.style.width = `${(this.value / 100) * 270}px`;
    }
    if (valText) {
      valText.textContent = `${Math.round(this.value)}%`;
    }
  }

  render() {
    const coords = this.getDialCoordinates();

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: inline-block;
          user-select: none;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }

        .meter-container {
          position: relative;
          width: 540px;
          height: 80px;
          background-image: url('/assets/happy_meter_banner.png');
          background-size: 540px 80px;
          background-repeat: no-repeat;
          display: flex;
          align-items: center;
          filter: drop-shadow(0 6px 16px rgba(0,0,0,0.3));
        }

        /* Celestial dial viewport (fits inside the circular aperture of the Happy Meter banner) */
        .dial-viewport {
          position: absolute;
          left: 17px;
          top: 7px;
          width: 66px;
          height: 66px;
          border-radius: 50%;
          overflow: hidden;
          background: #000;
          box-shadow: inset 0 2px 6px rgba(0,0,0,0.6);
        }

        .dial-sun-moon {
          width: 798px;
          height: 456px;
          background-image: url('/assets/ui_meter_sheet.png');
          background-repeat: no-repeat;
          background-position: -${coords.x}px -${coords.y}px;
          transform: scale(0.579);
          transform-origin: top left;
          transition: background-position 0.4s cubic-bezier(0.4, 0, 0.2, 1);
        }

        /* Progress track slot */
        .progress-track {
          position: absolute;
          left: 122px;
          top: 42px;
          width: 270px;
          height: 16px;
          background: rgba(15, 23, 42, 0.4);
          border-radius: 8px;
          overflow: hidden;
        }

        .meter-fill {
          height: 100%;
          width: ${(this.value / 100) * 270}px;
          background: linear-gradient(90deg, #38bdf8, #818cf8 50%, #ec4899 100%);
          border-radius: 8px;
          transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          box-shadow: 0 0 10px rgba(236, 72, 153, 0.6);
        }

        .meter-val-text {
          position: absolute;
          left: 405px;
          top: 40px;
          font-size: 13px;
          font-weight: 800;
          color: #ffffff;
          text-shadow: 0 1px 3px rgba(0,0,0,0.8);
          font-variant-numeric: tabular-nums;
        }
      </style>

      <div class="meter-container" role="progressbar" aria-valuenow="${this.value}" aria-valuemin="0" aria-valuemax="100">
        <div class="dial-viewport" title="Celestial Time: ${this.time}">
          <div class="dial-sun-moon"></div>
        </div>
        <div class="progress-track">
          <div class="meter-fill"></div>
        </div>
        <span class="meter-val-text">${Math.round(this.value)}%</span>
      </div>
    `;
  }
}

if (!customElements.get('happy-meter')) {
  customElements.define('happy-meter', HappyMeterElement);
}
