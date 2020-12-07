import './Index.css';

import m from 'mithril';
import StoredStream from '../StoredStream';

import 'ol/ol.css';
import * as ol from 'ol';
import olLayerTile from 'ol/layer/Tile';
import olLayerImage from 'ol/layer/Image';
import olVectorLayer from 'ol/layer/Vector';
import olVectorSource from 'ol/source/Vector';
import * as olStyle from 'ol/style';
import olPoint from 'ol/geom/Point';
import olFeature from 'ol/Feature';
import olSourceRaster from 'ol/source/Raster';
import olSourceXYZ from 'ol/source/XYZ';
import * as olProj from 'ol/proj';
import * as olInteraction from 'ol/interaction';

import * as d3Array from 'd3-array';
import * as d3Color from 'd3-color';

import { Drag } from '../Drag';
import _ from 'lodash';

import tippy from 'tippy.js';
import 'tippy.js/dist/tippy.css';
import classNames from 'classnames';


function colorStringToTuple(s: string): [number, number, number] {
  const rgb = d3Color.color(s)!.rgb();
  return [rgb.r, rgb.g, rgb.b];
}

const colors = [
  "#f44336",
  "#e91e63",
  "#9c27b0",
  "#673ab7",
  "#3f51b5",
  "#2196f3",
  "#03a9f4",
  "#00bcd4",
  "#009688",
  "#4caf50",
  "#8bc34a",
  "#cddc39",
  "#ffeb3b",
  "#ffc107",
  "#ff9800",
  "#ff5722",
  "#795548",
  "#607d8b",
];


interface TooltipAttrs {
  setColor: (color: string) => void,
  remove: () => void,
}
const Tooltip: m.ClosureComponent<TooltipAttrs> = () => {
  return {
    view: ({attrs: {setColor, remove}}) => {
      return m('.Tooltip',
        m('.Tooltip-x', {
          onclick: () => remove(),
        }),
        m('.Tooltip-grid',
          colors.map((color) =>
            m('.Tooltip-swatch', {
              style: {
                boxShadow: color + ' 0px 0px 0px 14px inset',
              },
              onclick: () => setColor(color),
            }),
          ),
        ),
      );
    },
  };
};



interface Stop {
  elevation: number,
  colorDown: [number, number, number],
  colorUp: [number, number, number],
  editable?: boolean,
}

enum Theme {
  dark = 'dark',
  light = 'light',
  black = 'black',
  white = 'white',
}

interface View {
  center: [number, number],
  zoom: number,
}

const tickTextPadding = 5;
const tickLineLength = 10;
const ribbonWidth = 50;
const svgBottomPadding = 10;

const r = ribbonWidth / 2;

const Index: m.ClosureComponent = () => {
  const theme$ = StoredStream<Theme>('elevator:theme', Theme.light);
  theme$.map(() => m.redraw());

  const view$ = StoredStream<View>('elevator:view', {
    center: [-122.436667, 37.753333],
    zoom: 10,
  });

  let defaultStops: Stop[] = [
    { elevation: 660, colorDown: [156, 39, 176], colorUp: [139, 195, 74] },
    { elevation: 1276.666666666667, colorDown: [255, 87, 34], colorUp: [0, 150, 136] },
  ];
  let stops$ = StoredStream('elevator:stops', defaultStops);
  function refreshStops() {
    stops$(_.sortBy(stops$(), 'elevation'));
  }

  let alpha$ = StoredStream('elevator:alpha', 127);

  let hoverStop: Stop | undefined;
  let hoverGradX: number;
  let hoverGradY: number;

  let hoveredElevation: number | undefined;

  let coloredElevation: olSourceRaster | undefined;

  function pixelToElevation(pixel: number[]) {
    return ((pixel[0] * 256 + pixel[1] + pixel[2] / 256) - 32768) * 3.281;
  }

  // returns the index of the stop higher than the given elevation, or stops.length if there is none
  function getNextStopIdx(stops: Stop[], e: number): number {
    let i;
    for (i = 0; i < stops.length; i++) {
      if (stops[i].elevation > e) {
        break;
      }
    }
    return i;
  }

  function colorTupleToString(color: [number, number, number], alpha: number) {
    return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha / 255})`;
  }

  const backgroundTiles = new olLayerTile();
  const foregroundTiles = new olLayerTile();

  const ext = window.devicePixelRatio > 1 ? '@2x.png' : '.png';
  const tilePixelRatio = window.devicePixelRatio > 1 ? 2 : 1;
  const makeSource = (name: string) => new olSourceXYZ({
    url: `https://a.basemaps.cartocdn.com/${name}/{z}/{x}/{y}${ext}`,
    tilePixelRatio,
  });
  const backgroundSources = {
    dark: makeSource('dark_nolabels'),
    light: makeSource('light_nolabels'),
    black: 'black',
    white: 'white',
  };
  const foregroundSources = {
    dark: makeSource('dark_only_labels'),
    light: makeSource('light_only_labels'),
    black: null,
    white: null,
  };
  theme$.map((theme) => {
    const backgroundSource = backgroundSources[theme];
    if (backgroundSource instanceof olSourceXYZ) {
      backgroundTiles.setSource(backgroundSource);
      backgroundTiles.setVisible(true);
    } else {
      backgroundTiles.setVisible(false);
    }

    const foregroundSource = foregroundSources[theme];
    if (foregroundSource instanceof olSourceXYZ) {
      foregroundTiles.setSource(foregroundSource);
      foregroundTiles.setVisible(true);
    } else {
      foregroundTiles.setVisible(false);
    }
  });

  function oncreateMap(vnode: m.VnodeDOM) {
    const target = vnode.dom as HTMLElement;

    const mapzenKey = 'nyhacpH_Qpixarat23uoRg';

    const elevationSource = new olSourceXYZ({
      // attributions: attributions,
      url: `https://tile.nextzen.org/tilezen/terrain/v1/512/terrarium/{z}/{x}/{y}.png?api_key=${mapzenKey}`,
      crossOrigin: 'anonymous',
      maxZoom: 14,
      imageSmoothing: false,
    });

    // const interpolateLab = d3.interpolateLab;

    interface RasterData {
      stops: Stop[],
      alpha: number,
    }
    coloredElevation = new olSourceRaster({
      sources: [ elevationSource ],
      operation: function (pixels, data) {
        const {pixelToElevation, getNextStopIdx} = this as any;  // necessary cuz of minification

        pixels = pixels as number[][];  // boo

        const { stops, alpha } = data as RasterData;
        const pixel = pixels[0];
        const e = pixelToElevation(pixel);

        const i = getNextStopIdx(stops, e);

        // lower than lowest stop
        if (i === 0) {
          if (e < 0) {
            return [0, 0, 0, 0];
          } else {
            const upperStop: Stop | undefined = stops[i];
            if (upperStop) {
              const upperColor = upperStop.colorDown;
              const t = e / upperStop.elevation;
              return [upperColor[0], upperColor[1], upperColor[2], t * alpha];
            } else {
              return [0, 0, 0, 0];
            }
          }
        }

        // so this must be is defined!
        const lowerStop: Stop = stops[i - 1];

        // but this might not be
        const upperStop: Stop | undefined = stops[i];

        if (upperStop) {
          const lowerColor = lowerStop.colorUp;
          const upperColor = upperStop.colorDown;

          const t = (e - lowerStop.elevation) / (upperStop.elevation - lowerStop.elevation);
          return [
            lowerColor[0] * (1-t) + upperColor[0] * t,
            lowerColor[1] * (1-t) + upperColor[1] * t,
            lowerColor[2] * (1-t) + upperColor[2] * t,
            alpha,
          ];
          // return d3Interpolate.interpolateLab(lowerStop.color, upperStop.color)(0.5);
        } else {
          return [lowerStop.colorUp[0], lowerStop.colorUp[1], lowerStop.colorUp[2], alpha];
        }
      },
      lib: {
        pixelToElevation,
        getNextStopIdx,
        // interpolateLab,
      },
    });
    coloredElevation.on('beforeoperations', function (event) {
      const data: RasterData = {
        stops: stops$(),
        alpha: alpha$(),
      };
      Object.assign(event.data, data);
    });

    const canvas = document.createElement('canvas');
    canvas.id = 'icon-canvas';
    canvas.width = 300 * devicePixelRatio;
    canvas.height = 300 * devicePixelRatio;
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    document.body.appendChild(canvas);

    const pointFeature = new olFeature(new olPoint([0, 0]));
    const pointSource = new olVectorSource();
    const pointLayer = new olVectorLayer({
      source: pointSource,
      style: (feature) => {
        ctx.clearRect(0, 0, 300, 300);

        ctx.save(); {
          ctx.translate(150, 150);
          ctx.rotate(Math.atan2(hoverGradY, hoverGradX) + Math.PI/2);

          const xr = 20;
          const yr = 16;

          ctx.beginPath();
          ctx.moveTo(-xr, 0);
          ctx.lineTo(xr, 0);
          ctx.lineTo(0, -yr);
          ctx.fillStyle = colorTupleToString(hoverStop!.colorUp, alpha$());
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(-xr, 0);
          ctx.lineTo(xr, 0);
          ctx.lineTo(0, yr);
          ctx.fillStyle = colorTupleToString(hoverStop!.colorDown, alpha$());
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(-xr, 0);
          ctx.lineTo(0, yr);
          ctx.lineTo(xr, 0);
          ctx.lineTo(0, -yr);
          ctx.closePath();
          ctx.strokeStyle = "#888";
          ctx.stroke();

          // ctx.beginPath();
          // ctx.fillStyle = colorArrayToString(hoverStop!.colorDown, alpha$());
          // ctx.arc(0, 0, 15, Math.PI/2, 3*Math.PI/2);
          // ctx.fill();
          // ctx.beginPath();
          // ctx.fillStyle = colorArrayToString(hoverStop!.colorUp, alpha$());
          // ctx.arc(0, 0, 15, Math.PI/2, 3*Math.PI/2, true);
          // ctx.fill();
        } ctx.restore();

        if (!dragInteraction.active) {
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.font = '10px Helvetica';

          const text = 'SHIFT to drag';

          const [fgColor, bgColor] = {
            light: ['rgba(0,0,0,1)', 'rgba(255,255,255,1)'],
            white: ['rgba(0,0,0,1)', 'rgba(255,255,255,1)'],
            dark: ['rgba(255,255,255,1)', 'rgba(0,0,0,1)'],
            black: ['rgba(255,255,255,1)', 'rgba(0,0,0,1)'],
          }[theme$()];

          ctx.save(); {
            ctx.filter = 'blur(1px)';
            ctx.fillStyle = bgColor;
            ctx.fillText(text, 150, 170);
            ctx.fillText(text, 150, 170);
            ctx.fillText(text, 150, 170);
          } ctx.restore();

          ctx.fillStyle = fgColor;
          ctx.fillText(text, 150, 170);
        }

        return new olStyle.Style({
          image: new olStyle.Icon({
            // src: 'https://openlayers.org/en/latest/examples/data/icon.png',
            // anchor: [0.5, 46],
            // anchorXUnits: 'fraction',
            // anchorYUnits: 'pixels',
            img: canvas,
            imgSize: [canvas.width, canvas.height],
            // anchor: [150, 150],
            anchor: [0.5, 0.5],
            scale: 1 / devicePixelRatio,
          }),
          // new olStyle.Circle({
          //   radius: 10,
          //   fill: new olStyle.Fill({color: feature.get('fill')}),
          //   stroke: new olStyle.Stroke({color: '#aaa', width: 1}),
          // }),
        });
      },
    });

    class ContourDrag extends olInteraction.Pointer {
      active = false;

      handleDownEvent(mapBrowserEvent: ol.MapBrowserEvent) {
        if (hoverStop !== undefined && (mapBrowserEvent.originalEvent as MouseEvent).shiftKey) {
          this.active = true;
          map.getTargetElement().style.cursor = 'grabbing';
          return true;
        } else {
          return false;
        }
      }

      handleUpEvent() {
        this.active = false;
        return false;
      }
    }
    const dragInteraction = new ContourDrag();


    const map = new ol.Map({
      target,
      interactions: olInteraction.defaults().extend([dragInteraction]),
      layers: [
        backgroundTiles,
        new olLayerImage({
          source: coloredElevation,
        }),
        new olLayerTile({
          source: elevationSource,
          className: 'elevation-invisible',
        }),
        foregroundTiles,
        pointLayer,
      ],
    });

    requestAnimationFrame(() => {
      const invisibleElevation = document.querySelector('.elevation-invisible canvas') as HTMLCanvasElement;
      invisibleElevation.style.opacity = '0';
    });

    map.on('moveend', () => {
      const view = map.getView();
      view$({
        center: olProj.toLonLat(view.getCenter()) as [number, number],
        zoom: view.getZoom(),
      });
    });

    view$.map((view) => {
      map.setView(new ol.View({
        center: olProj.fromLonLat(view.center),
        zoom: view.zoom,
      }));
    });


    map.on('pointermove', (olEvt: ol.MapBrowserEvent) => {
      // console.log(olEvt, olEvt.coordinate, olProj.toLonLat(olEvt.coordinate));
      const evt = olEvt.originalEvent as PointerEvent;
      let x = Math.round(evt.clientX);
      let y = Math.round(evt.clientY);
      const invisibleElevation = document.querySelector('.elevation-invisible canvas') as HTMLCanvasElement;
      const ctx = invisibleElevation.getContext('2d')!;
      let pixel = ctx.getImageData(x, y, 1, 1).data;  // TODO: only works cuz map is top-left lol
      let e = pixelToElevation(pixel as any);
      hoveredElevation = e;

      m.redraw();

      if (dragInteraction.active) {
        hoverStop!.elevation = e;
        refreshStops();
        coloredElevation?.changed();
      }
      let jump = 4;
      let iMin = Infinity;
      let iMax = -Infinity;
      hoverGradX = 0;
      hoverGradY = 0;
      for (let dx = -jump; dx <= jump; dx += jump) {
        for (let dy = -jump; dy <= jump; dy += jump) {
          let pixel = ctx.getImageData(x + dx, y + dy, 1, 1).data;
          let e = pixelToElevation(pixel as any);
          let i = getNextStopIdx(stops$(), e);
          if (i < iMin) { iMin = i; }
          if (i > iMax) { iMax = i; }
          hoverGradX += e * dx;
          hoverGradY += e * dy;
        }
      }

      if (!dragInteraction.active) {
        if (iMax > iMin) {
          hoverStop = stops$()[iMin];
          pointFeature.set('fill', hoverStop.colorUp);  // TODO
          if (!pointSource.hasFeature(pointFeature)) {
            pointSource.addFeature(pointFeature);
          }
          pointSource.changed();
          map.getTargetElement().style.cursor = 'grab';
        } else {
          hoverStop = undefined;
          if (pointSource.hasFeature(pointFeature)) {
            pointSource.removeFeature(pointFeature);
          }
          pointSource.changed();
          map.getTargetElement().style.cursor = '';
        }
      }

      pointFeature.setGeometry(new olPoint(olEvt.coordinate));
    });
  }

  let yPerElev = 600 / 2000;
  function elevToY(elev: number) {
    return (svgHeight - svgBottomPadding) - elev * yPerElev;
  }
  function yToElev(y: number) {
    return ((svgHeight - svgBottomPadding) - y) / yPerElev;
  }

  let dragActive = false;

  class StopDrag extends Drag {
    constructor(readonly initialElev: number, readonly setElev: (elev: number) => void) {
      super();
    }

    onMove() {
      this.setElev(yToElev(elevToY(this.initialElev) + this.deltaPx![1]));
      coloredElevation?.changed();
    }

    onConsummate() { dragActive = true; }
    onUp() { dragActive = false; }
  }

  class AxisDrag extends Drag {
    draggedElev = undefined as any as number;

    constructor() {
      super();
    }

    onMove(ev: MouseEvent) {
      const y = ev.clientY - svgDom.getBoundingClientRect().y;
      yPerElev = _.clamp((elevToY(0) - y) / this.draggedElev, 0.03, 1);
      m.redraw();
    }

    onConsummate(ev: MouseEvent) {
      const y = ev.clientY - svgDom.getBoundingClientRect().y;
      this.draggedElev = yToElev(y);
      dragActive = true;
    }
    onUp() { dragActive = false; }
  }

  function onclickBackground(ev: MouseEvent) {
    const target = ev.target as HTMLElement;
    const bbox = target.getBoundingClientRect();
    const e = yToElev(ev.clientY - bbox.top);
    const i = getNextStopIdx(stops$(), e);
    const [colorDown, colorUp] = _.sampleSize(colors, 2);
    stops$().splice(i, 0, {
      elevation: e,
      colorDown: colorStringToTuple(colorDown),
      colorUp: colorStringToTuple(colorUp),
    });
    refreshStops();
    m.redraw();
    coloredElevation?.changed();
  }

  const backgroundSource = backgroundSources[theme$()];
  const background = typeof backgroundSource === 'string' ? backgroundSource : undefined;

  function makeRibbon(i: number, lowerY: number, lowerColor: string, upperY: number, upperColor: string) {
    return [
      m('defs',
        m('linearGradient', {id: `grad${i}`, x1: '0%', y1: '100%', x2: '0%', y2: '0%'},
          m('stop[offset=0%]', {style: `stop-color: ${lowerColor}`}),
          m('stop[offset=100%]', {style: `stop-color: ${upperColor}`}),
        )
      ),
      m('path.Index-ribbon', {
        d: `
          M ${-r} ${lowerY}
          L ${-r} ${upperY}
          L ${r} ${upperY}
          L ${r} ${lowerY}
        `,
        fill: `url(#grad${i})`,
      }),
    ];
  }

  let svgDom: HTMLElement, svgWidth: number, svgHeight: number;

  return {
    view: () => {
      return m('.Index', {'data-theme': theme$()},
        m('.Index-map', {
          oncreate: oncreateMap,
          style: {
            background,
          },
        }),
        m('.Index-display', hoveredElevation !== undefined ? `${hoveredElevation.toFixed(0)} ft`: ''),
        m('.Index-controls',
          m('svg.Index-stops-svg', {
            oncreate: ({dom}) => {
              svgDom = dom as HTMLElement;
              function onResize() {
                const bbox = dom.getBoundingClientRect();
                svgWidth = bbox.width;
                svgHeight = bbox.height;
                m.redraw();
              }
              window.addEventListener('resize', onResize);
              onResize();
            },
          },
            svgWidth && svgHeight && [
              m('filter#blur',
                m('feGaussianBlur', {stdDeviation: 5}),
                m('feColorMatrix', {
                  type: 'matrix',
                  values: `
                    1 0 0 0 0
                    0 1 0 0 0
                    0 0 1 0 0
                    0 0 0 3 0
                  `,
                }),
              ),
              m('pattern#diagonals[width=8][height=8][patternUnits=userSpaceOnUse]',
                m('path', {
                  d: "M-2,2 l4,-4 M0,8 l8,-8 M6,10 l4,-4",
                  style: { stroke: '#aaa', strokeWidth: 2 },
                }),
              ),
              m('g.Index-axis', {
                onmousedown: (ev: MouseEvent) => new AxisDrag().start(ev),
              },
                m('rect', {fill: 'transparent', width: svgWidth / 2 - r, height: svgHeight, x: 0}),
                d3Array.ticks(0, (svgHeight - svgBottomPadding - 50) / yPerElev, 10).map((tickElev, i) =>
                  m('g', {transform: `translate(${svgWidth / 2 - r}, ${elevToY(tickElev)})`},
                    m('line.Index-axis-tick', {x1: 0, y1: 0, x2: -tickLineLength, y2: 0}),
                    m('text.Index-axis-tick-label', {x: -tickLineLength-tickTextPadding}, tickElev.toLocaleString() + (i === 0 ? ' ft' : ''))
                  )
                ),
              ),
              m('g', {transform: `translate(${svgWidth/2}, 0)`},
                m('rect.Index-ribbon-background', {
                  x: -ribbonWidth / 2,
                  y: 0,
                  width: ribbonWidth,
                  height: svgHeight,
                  fill: stops$().length === 0 ? 'url(#diagonals)' : 'transparent',
                  stroke: 'none',
                  onclick: onclickBackground,
                }),
                stops$().map((lowerStop, i) => {
                  const lowerY = elevToY(lowerStop.elevation)!;
                  let lowerColor = colorTupleToString(lowerStop.colorUp, alpha$());

                  let ribbons = [];
                  const upperStop = stops$()[i + 1];
                  if (upperStop) {
                    const upperY = elevToY(upperStop.elevation)!;
                    const upperColor = colorTupleToString(upperStop.colorDown, alpha$());
                    ribbons.push(makeRibbon(i + 1, lowerY, lowerColor, upperY, upperColor));
                  } else {
                    const upperY = 0;
                    const upperColor = lowerColor;
                    ribbons.push(makeRibbon(i + 1, lowerY, lowerColor, upperY, upperColor));
                  }

                  if (i === 0) {
                    ribbons.push(makeRibbon(0, elevToY(0)!, colorTupleToString(lowerStop.colorDown, 0), lowerY, colorTupleToString(lowerStop.colorDown, alpha$())));
                  }

                  function onmousedownTriangle(ev: MouseEvent) {
                    new StopDrag(lowerStop.elevation, (e) => {
                      lowerStop.elevation = e;
                      refreshStops();
                      coloredElevation?.changed();
                    }).start(ev);
                  }

                  function oncreateTriangle(dom: HTMLElement, dir: 'colorUp' | 'colorDown') {
                    const tooltipContent = document.createElement('div');
                    tippy(dom, {
                      content: () => {
                        m.mount(tooltipContent, {view: () => m(Tooltip, {
                          setColor: (color) => {
                            stops$()[i][dir] = colorStringToTuple(color);
                            refreshStops();
                            coloredElevation?.changed();
                            m.redraw();
                          },
                          remove: () => {
                            stops$().splice(i, 1);
                            refreshStops();
                            coloredElevation?.changed();
                            m.redraw();
                          },
                        })});
                        return tooltipContent;
                      },
                      onDestroy: () => {
                        m.mount(tooltipContent, null);
                      },
                      onShow: () => {
                        if (dragActive) { return false; }
                      },
                      placement: 'left',
                      offset: [0, -10],
                      interactive: true,
                      appendTo: document.body,
                    });
                  }

                  return [
                    ribbons,
                    m('g', {
                      class: classNames({['Index-stop-hovered']: lowerStop === hoverStop}),
                    },
                      m('path.Index-stop-background', {
                        d: `
                          M ${-r} ${lowerY}
                          L ${0} ${lowerY-20}
                          L ${r} ${lowerY}
                          L ${0} ${lowerY+20}
                          z
                        `,
                        fill: 'white',
                      }),
                      m('path.Index-stop-triangle', {
                        d: `
                          M ${-r} ${lowerY}
                          L ${r} ${lowerY}
                          L ${0} ${lowerY+20}
                        `,
                        fill: colorTupleToString(lowerStop.colorDown, 255),
                        onmousedown: onmousedownTriangle,
                        oncreate: ({dom}) => oncreateTriangle(dom as HTMLElement, 'colorDown'),
                      }),
                      m('path.Index-stop-triangle', {
                        d: `
                          M ${-r} ${lowerY}
                          L ${r} ${lowerY}
                          L ${0} ${lowerY-20}
                        `,
                        fill: colorTupleToString(lowerStop.colorUp, 255),
                        onmousedown: onmousedownTriangle,
                        oncreate: ({dom}) => oncreateTriangle(dom as HTMLElement, 'colorUp'),
                      }),
                      m('path.Index-stop-outline', {
                        d: `
                          M ${-r} ${lowerY}
                          L ${0} ${lowerY-20}
                          L ${r} ${lowerY}
                          L ${0} ${lowerY+20}
                          z
                        `,
                        fill: 'none',
                        stroke: '#888',
                      }),
                    ),
                  ];
                })
              ),
            ]
          ),
          m('', 'alpha'),
          m('input.Index-alpha-slider[type=range][min=0][max=255]', {value: alpha$(), oninput: (ev: InputEvent) => {
            alpha$(+(ev.target as HTMLInputElement).value);
            coloredElevation?.changed();
          }}),
          m('', 'theme'),
          m('select.Index-theme-select', {value: theme$(), onchange: (ev: InputEvent) => theme$((ev.target as HTMLSelectElement).value as Theme)},
            Object.keys(Theme).map(theme => m('option', {value: theme}, theme))
          ),
        ),
      );
    },
  };
};
export default Index;
