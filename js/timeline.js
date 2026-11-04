import { WorldData, epochForYear } from './data-store.js';
import { AnnualChronicle } from './history-engine.js';

export class TimelineController {
  constructor({ onChange = () => {}, chronicle = new AnnualChronicle() } = {}) {
    this.slider = document.getElementById('time-slider');
    this.onChange = onChange;
    this.chronicle = chronicle;
    this.value = Number.parseInt(this.slider?.value ?? '-250', 10);
    this.currentRecord = this.chronicle.getYear(this.value);
    this._renderMilestones();
    this._bind();
    this.update(this.value, { emit: false });
  }

  _bind() {
    if (!this.slider) return;
    this.slider.addEventListener('input', () => this.update(Number(this.slider.value)));
  }

  _renderMilestones() {
    const container = document.getElementById('milestone-list');
    if (!container) return;
    const fragment = document.createDocumentFragment();
    WorldData.milestones
      .slice()
      .sort((a, b) => a.year - b.year)
      .forEach(milestone => {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.yearJump = String(milestone.year);
        button.setAttribute('aria-label', `Перейти к году ${this.formatYear(milestone.year)}: ${milestone.label}`);
        const year = document.createElement('span');
        year.textContent = milestone.year < 0 ? `−${Math.abs(milestone.year)}` : milestone.year > 0 ? `+${milestone.year}` : '0';
        const label = document.createElement('small');
        label.textContent = milestone.label;
        button.append(year, label);
        button.addEventListener('click', () => this.setYear(milestone.year));
        fragment.append(button);
      });
    container.replaceChildren(fragment);
  }

  formatYear(year = this.value, compact = false) {
    if (year < 0) return compact ? `${Math.abs(year)} до н.э.` : `${Math.abs(year)} год до н.э.`;
    if (year === 0) return compact ? 'Год 0' : 'Год 0 · День Шал-Кари';
    return compact ? `+${year} н.э.` : `+${year} год н.э.`;
  }

  update(year, { emit = true } = {}) {
    const minimum = Number(this.slider?.min ?? -500);
    const maximum = Number(this.slider?.max ?? 500);
    this.value = Math.max(minimum, Math.min(maximum, Math.round(Number(year))));
    this.currentRecord = this.chronicle.getYear(this.value);

    if (this.slider) {
      this.slider.value = String(this.value);
      const progress = ((this.value - minimum) / (maximum - minimum)) * 100;
      this.slider.style.setProperty('--range-progress', `${progress}%`);
      this.slider.setAttribute('aria-valuetext', this.formatYear(this.value));
    }
    document.querySelectorAll('[data-year-jump]').forEach(button => {
      button.classList.toggle('is-current', Number(button.dataset.yearJump) === this.value);
    });

    const epoch = epochForYear(this.value);
    const title = document.getElementById('epoch-title');
    const date = document.getElementById('year-display');
    const compactDate = document.getElementById('timeline-year');
    const heading = document.getElementById('chronicle-title');
    const log = document.getElementById('global-log');
    const epochIndex = document.getElementById('epoch-index');
    const progressBar = document.getElementById('epoch-progress');
    const eraLabel = document.getElementById('map-era-label');
    const waterState = document.getElementById('water-state');
    const settlementState = document.getElementById('settlement-state');
    const conflictState = document.getElementById('conflict-state');
    const epochPosition = ((this.value - epoch.startYear) / (epoch.endYear - epoch.startYear + 1)) * 100;
    const record = this.currentRecord;

    if (title) title.textContent = epoch.title;
    if (date) date.textContent = this.formatYear(this.value);
    if (compactDate) compactDate.textContent = this.formatYear(this.value, true);
    if (heading) heading.textContent = record.title;
    if (log) {
      const fragment = document.createDocumentFragment();
      record.paragraphs.forEach(paragraph => {
        const item = document.createElement('p');
        item.textContent = paragraph;
        fragment.append(item);
      });
      log.replaceChildren(fragment);
    }
    if (waterState) waterState.textContent = `Вода: ${record.water.percent}% · ${record.water.stage}`;
    if (settlementState) settlementState.textContent = `Поселения: ${record.activeSettlementCount} действуют`;
    if (conflictState) conflictState.textContent = record.wars.length
      ? `Война: ${record.wars[0].name}`
      : record.activeScar ? `Восстановление: ${record.activeScar.name}` : 'Открытых войн нет';
    if (epochIndex) epochIndex.textContent = epoch.index;
    if (progressBar) progressBar.style.width = `${Math.max(0, Math.min(100, epochPosition))}%`;
    if (eraLabel) eraLabel.textContent = this.value < 0 ? 'ДО ДНЯ ШАЛ-КАРИ' : this.value <= 34 ? 'ПЕРВЫЕ РАЗЛИВЫ' : this.value <= 260 ? 'НОВАЯ БЕРЕГОВАЯ ЛИНИЯ' : 'ЭРА ОСТРОВНЫХ ПУТЕЙ';

    if (emit) this.onChange(this.value, epoch, record);
    return epoch;
  }

  setYear(year, options) {
    return this.update(year, options);
  }

  getCurrentYear() {
    return this.value;
  }

  getCurrentRecord() {
    return this.currentRecord;
  }
}