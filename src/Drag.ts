import m from 'mithril';

type Point = [number, number];

export class Drag {
  static current?: Drag

  consummationTimeThreshold = 200
  consummationDistanceThreshold = 4

  startPx?: Point
  startTime?: number
  consummated?: boolean

  lastPx?: Point
  deltaPx: Point
  dPx: Point

  _onMouseMove?: (moveEvent: MouseEvent) => void
  _onMouseUp?: (moveEvent: MouseEvent) => void

  constructor() {
    this.deltaPx = undefined as any;  // TODO: HACK
    this.dPx = undefined as any;  // TODO: HACK
  }

  onMove?(moveEvent: MouseEvent): void;
  onConsummate?(moveEvent: MouseEvent): void;
  onUp?(upEvent: MouseEvent): void;
  onCancel?(upEvent?: MouseEvent): void;

  start(downEvent: MouseEvent): void {
    this.startPx = [downEvent.clientX, downEvent.clientY];
    this.startTime = downEvent.timeStamp;
    this.consummated = false;

    this._onMouseMove = (moveEvent: MouseEvent) => {
      moveEvent.preventDefault();

      this.deltaPx = [moveEvent.clientX - this.startPx![0], moveEvent.clientY - this.startPx![1]];

      if (!this.consummated) {
        if (moveEvent.timeStamp - this.startTime! >= this.consummationTimeThreshold ||
            Math.hypot(...this.deltaPx) >= this.consummationDistanceThreshold) {
          this.consummated = true;
          Drag.current = this;
          this.lastPx = this.startPx;
          if (this.onConsummate) {
            this.onConsummate(moveEvent);
          }
        }
      }
      if (this.consummated) {
        this.dPx = [moveEvent.clientX - this.lastPx![0], moveEvent.clientY - this.lastPx![1]];
        if (this.onMove) { this.onMove(moveEvent); }
        this.lastPx = [moveEvent.clientX, moveEvent.clientY];
      }
      m.redraw();
    };
    this._onMouseUp = (upEvent: MouseEvent) => {
      if (this.consummated) {
        if (this.onUp) { this.onUp(upEvent); }
      } else {
        if (this.onCancel) { this.onCancel(upEvent); }
      }
      this._cleanup();
      m.redraw();
    };

    window.addEventListener("mousemove", this._onMouseMove);
    window.addEventListener("mouseup",   this._onMouseUp);
  }

  cancel(): void {
    if (this.onCancel) { this.onCancel(); }
    this._cleanup();
  }

  _cleanup(): void {
    Drag.current = undefined;
    if (this._onMouseMove) { window.removeEventListener("mousemove", this._onMouseMove); }
    if (this._onMouseUp)   { window.removeEventListener("mouseup", this._onMouseUp); }
  }
}