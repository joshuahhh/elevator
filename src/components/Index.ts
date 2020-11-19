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

import * as d3Scale from 'd3-scale';
import * as d3Color from 'd3-color';

import { Drag } from '../Drag';
import _ from 'lodash';

import tippy from 'tippy.js';
import 'tippy.js/dist/tippy.css';

interface TooltipAttrs {
  setColor: (color: string) => void,
  remove: () => void,
}
const Tooltip: m.ClosureComponent<TooltipAttrs> = () => {
  return {
    view: ({attrs: {setColor, remove}}) => {
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

const tickTextWidth = 50;
const tickMarginWidth = 5;
const tickLineWidth = 10;
const ribbonWidth = 50;

const r = ribbonWidth / 2;

const ribbonX = tickTextWidth + tickMarginWidth + tickLineWidth;

const Index: m.ClosureComponent = () => {
  const theme$ = StoredStream<Theme>('elevator:theme', Theme.light);
  theme$.map(() => m.redraw());

  const view$ = StoredStream<View>('elevator:view', {
    center: [-122.436667, 37.753333],
    zoom: 8,
  });

  let defaultStops: Stop[] = [
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

  function colorArrayToString(color: number[], alpha: number) {
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
          ctx.fillStyle = colorArrayToString(hoverStop!.colorUp, alpha$());
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(-xr, 0);
          ctx.lineTo(xr, 0);
          ctx.lineTo(0, yr);
          ctx.fillStyle = colorArrayToString(hoverStop!.colorDown, alpha$());
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

      // handleEvent(mapBrowserEvent: ol.MapBrowserEvent) {
      //   console.log(mapBrowserEvent);
      //   if (mapBrowserEvent.type == olMapBrowserEventType.DBLCLICK) {
      //     console.log('doubleclick!');
      //     mapBrowserEvent.preventDefault();
      //     return false;
      //   }
      //   return true;
      // }

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
      console.log('moveend');
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

  // function onmousedownMap(evt: PointerEvent) {
  //   console.log('mousedown');
  // }

  const maxElev = 2000;
  const scaleHeight = 600;

  let yScale = d3Scale.scaleLinear([0, maxElev], [scaleHeight, 0]);
  function yScalePixelsPerElev() {
    const [elev1, elev2] = yScale.domain();
    const [pix1, pix2] = yScale.range();
    return (pix2 - pix1) / (elev2 - elev1);
  }
  // let yScale = baseYScale;

  let dragActive = false;

  class CircleDrag extends Drag {
    constructor(readonly initialElev: number, readonly setElev: (elev: number) => void) {
      super();
    }

    onMove() {
      this.setElev(yScale.invert(yScale(this.initialElev)! + this.deltaPx![1]));
      coloredElevation?.changed();
    }

    onConsummate() { dragActive = true; }
    onUp() { dragActive = false; }
  }

  class AxisDrag extends Drag {
    constructor() {
      super();
    }

    onMove() {

      const unclampedDElev = -this.dPx[1] / yScalePixelsPerElev();
      const [d1, d2] = yScale.domain();
      const unclampedNewD1 = d1 + unclampedDElev;
      const newD1 = Math.max(0, unclampedNewD1);
      const deltaElev = newD1 - d1;
      yScale.domain([d1 + deltaElev, d2 + deltaElev]);

      m.redraw();

      // yScale.invert(yScaleinvert(this.startElev))
      // this.setElev(yScale.invert(yScale(this.initialElev)! + this.deltaPx![1]));
      // coloredElevation?.changed();
    }

    onConsummate() { dragActive = true; }
    onUp() { dragActive = false; }
  }

  function onwheelAxisArea(ev: WheelEvent) {
    // TODO: max & min scales
    // TODO: actually, you kinda wanna zoom out even when that requires not keeping the center point constant

    const y = ev.clientY - (ev.target as HTMLElement).getBoundingClientRect().top;
    const centerElev = yScale.invert(y);

    let scale = Math.exp(ev.deltaY / 60);
    function transformElev(elev: number) {
      return (elev - centerElev) * scale + centerElev;
    }

    const [elev1, elev2] = yScale.domain();
    let [elev1p, elev2p] = [transformElev(elev1), transformElev(elev2)];
    if (elev1p < 0) {
      elev2p = elev2p - elev1p;
      elev1p = 0;
    }
    const maxElevRange = 10000;
    if (elev2p - elev1p > maxElevRange) {
      const t = (centerElev - elev1p) / (elev2p - elev1p);
      elev1p = centerElev - t * maxElevRange;
      elev2p = centerElev + (1 - t) * maxElevRange;
    }
    yScale.domain([elev1p, elev2p]);

    m.redraw();

    ev.preventDefault();
  }

  function onclickBackground(ev: MouseEvent) {
    const target = ev.target as HTMLElement;
    const bbox = target.getBoundingClientRect();
    const e = yScale.invert(ev.clientY - bbox.top);
    const i = getNextStopIdx(stops$(), e);
    stops$().splice(i, 0, {
      elevation: e,
      colorDown: [0, 0, 0],  // TODO
      colorUp: [255, 255, 255],  // TODO
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


  return {
    view: () => {
      return m('.Index', {'data-theme': theme$()},
        m('.Index-left',
          m('.Index-map', {
            oncreate: oncreateMap,
            style: {
              background,
            },
          }),
          m('.Index-display', hoveredElevation !== undefined ? `${hoveredElevation.toFixed(0)} ft`: '')
        ),
        m('.Index-right',
          m('svg', {width: 200, height: 700},
            m('g.Index-axis', {
              onmousedown: (ev: MouseEvent) => new AxisDrag().start(ev),
              onwheel: onwheelAxisArea,
            },
              m('rect', {fill: 'transparent', width: ribbonX, height: 600, x: 0}),
              yScale.ticks().map((tickElev) =>
                m('g', {transform: `translate(${ribbonX}, ${yScale(tickElev)})`},
                  m('line.Index-axis-tick', {x1: 0, y1: 0, x2: -tickLineWidth, y2: 0}),
                  m('text.Index-axis-tick-label', {x: -tickLineWidth-tickMarginWidth}, tickElev.toLocaleString())
                )
              ),
            ),
            m('g', {transform: `translate(${ribbonX + ribbonWidth / 2}, 0)`},
              m('rect', {
                x: -ribbonWidth / 2,
                y: 0,
                width: ribbonWidth,
                height: scaleHeight + 0,
                fill: 'transparent',
                stroke: 'none',
                onclick: onclickBackground,
              }),
              stops$().map((lowerStop, i) => {
                const lowerY = yScale(lowerStop.elevation)!;
                let lowerColor = colorArrayToString(lowerStop.colorUp, alpha$());

                let ribbons = [];
                const upperStop = stops$()[i + 1];
                if (upperStop) {
                  const upperY = yScale(upperStop.elevation)!;
                  const upperColor = colorArrayToString(upperStop.colorDown, alpha$());
                  ribbons.push(makeRibbon(i + 1, lowerY, lowerColor, upperY, upperColor));
                } else {
                  const upperY = 0;
                  const upperColor = lowerColor;
                  ribbons.push(makeRibbon(i + 1, lowerY, lowerColor, upperY, upperColor));
                }

                if (i === 0) {
                  ribbons.push(makeRibbon(0, yScale(0)!, colorArrayToString(lowerStop.colorDown, 0), lowerY, colorArrayToString(lowerStop.colorDown, alpha$())));
                }

                function onmousedownTriangle(ev: MouseEvent) {
                  new CircleDrag(lowerStop.elevation, (e) => {
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
                          const rgb = d3Color.color(color)!.rgb();
                          stops$()[i][dir] = [rgb.r, rgb.g, rgb.b];
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
                  m('path.Index-stop-triangle', {
                    d: `
                      M ${-r} ${lowerY}
                      L ${r} ${lowerY}
                      L ${0} ${lowerY+20}
                    `,
                    fill: colorArrayToString(lowerStop.colorDown, 255),
                    onmousedown: onmousedownTriangle,
                    oncreate: ({dom}) => oncreateTriangle(dom as HTMLElement, 'colorDown'),
                  }),
                  m('path.Index-stop-triangle', {
                    d: `
                      M ${-r} ${lowerY}
                      L ${r} ${lowerY}
                      L ${0} ${lowerY-20}
                    `,
                    fill: colorArrayToString(lowerStop.colorUp, 255),
                    onmousedown: onmousedownTriangle,
                    oncreate: ({dom}) => oncreateTriangle(dom as HTMLElement, 'colorUp'),
                  }),
                  m('path', {
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
                ];
              })
            )
          ),
          m('',
            "theme: ",
            m('select', {value: theme$(), onchange: (ev: InputEvent) => theme$((ev.target as HTMLSelectElement).value as Theme)},
              Object.keys(Theme).map(theme => m('option', {value: theme}, theme))
            ),
          ),
          m('',
            'alpha: ',
            m('input[type=range][min=0][max=255]', {value: alpha$(), oninput: (ev: InputEvent) => {
              alpha$(+(ev.target as HTMLInputElement).value);
              coloredElevation?.changed();
            }})
          )
        ),
      );
    },
  };
};
export default Index;
