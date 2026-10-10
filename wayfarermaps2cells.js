// ==UserScript==
// @name         Pokémon Go Map S2 Grids
// @version      0.2.2
// @description  Adds L17 and L14 S2 cells to the Pokemon Go Map
// @namespace    https://gitlab.com/Tntnnbltn/wayfarer-addons
// @downloadURL  https://gitlab.com/Tntnnbltn/wayfarer-addons/-/raw/main/pokemon-go-map-s2.user.js
// @updateURL    https://gitlab.com/Tntnnbltn/wayfarer-addons/-/raw/main/pokemon-go-map-s2.user.js
// @homepageURL  https://gitlab.com/Tntnnbltn/wayfarer-addons
// @match        https://wayfarer.scopely.com/new/mapview
// @match        https://wayfarer.scopely.com/new/mapview*
// @run-at       document-start
// @grant        none
// ==/UserScript==

// Copyright 2026 tntnnbltn

// This script is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This script is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.

// You can find a copy of the GNU General Public License in the root
// directory of this script's GitLab repository:
// <https://gitlab.com/Tntnnbltn/wayfarer-addons/-/blob/main/LICENSE>
// If not, see <https://www.gnu.org/licenses/>.

(function networkSandbox() {
  // APIs that should not be usable by the wrapped script
  const blocked = [
    "fetch",
    "XMLHttpRequest",
    "WebSocket",
    "EventSource"
  ];

  const originals = {};

  function blockedFunction(name) {
    return function () {
      throw new Error(
        `[Network Sandbox] ${name} is blocked`
      );
    };
  }

  // Block normal JS networking APIs
  for (const name of blocked) {
    originals[name] = window[name];

    try {
      window[name] = blockedFunction(name);
    } catch {}
  }

  // Block navigator.sendBeacon
  let originalBeacon = null;

  if (navigator.sendBeacon) {
    originalBeacon = navigator.sendBeacon;

    try {
      navigator.sendBeacon = blockedFunction("navigator.sendBeacon");
    } catch {}
  }

  // Block WebRTC-style direct connections
  const rtcConstructors = [
    "RTCPeerConnection",
    "RTCDataChannel"
  ];

  const rtcOriginals = {};

  for (const name of rtcConstructors) {
    if (window[name]) {
      rtcOriginals[name] = window[name];

      try {
        window[name] = blockedFunction(name);
      } catch {}
    }
  }

  try {
    // ==========================================================
    //                 YOUR USERSCRIPT GOES HERE
    // ==========================================================

    // Paste the ENTIRE Pokémon Go Map S2 Grids script here.
    //
    // Start with its // ==UserScript== header and end with
    // the last line of the script.
    //
    // ==========================================================

    (() => {

      // -----------------------------
      // S2 grid overlay
      // -----------------------------

      const CONFIG = {
        L14: {
          level: 14,
          minZoom: 14,
          strokeColor: '#cc0000',
          strokeOpacity: 0.9,
          strokeWeight: 2.4,
          zIndex: 1400,
          maxCells: 1200,
        },

        L17: {
          level: 17,
          minZoom: 16,
          strokeColor: '#0066ff',
          strokeOpacity: 0.55,
          strokeWeight: 1,
          zIndex: 170,
          maxCells: 3500,
        },

        redrawDebounceMs: 150,

        // Expands the search area slightly beyond the viewport so grid lines do not
        // appear/disappear right at the edge while panning.
        viewportPaddingRatio: 0.18,
      };

      const state = {
        maps: [],
        activeMap: null,
        redrawTimer: null,
        overlaysByLevel: {
          14: new Map(),
          17: new Map(),
        },
        listenersAttached: false,
        originalGoogle: getPageWindow().google,
      };

      function debug(...args) {
        console.debug('[PGO S2 Grid]', ...args);
      }

      function getPageWindow() {
        try {
          if (typeof unsafeWindow !== 'undefined') return unsafeWindow;
        } catch (_) {}

        return window;
      }

      function getPgoMapMods() {
        const W = getPageWindow();

        if (W.__pgoMapMods?.version >= 1) {
          return W.__pgoMapMods;
        }

        const api = W.__pgoMapMods = {
          version: 1,
          maps: [],
          activeMap: null,
          callbacks: [],
          hookInstalled: false,

          isMapLike(obj) {
            return !!obj &&
              typeof obj.setCenter === 'function' &&
              typeof obj.setZoom === 'function' &&
              typeof obj.getCenter === 'function' &&
              typeof obj.getZoom === 'function' &&
              typeof obj.getDiv === 'function';
          },

          registerMap(map, source = 'unknown') {
            if (!api.isMapLike(map)) return map;

            if (!api.maps.includes(map)) {
              api.maps.push(map);
              api.activeMap = map;
              W.__pgoGoogleMap = map;

              for (const callback of [...api.callbacks]) {
                try {
                  callback(map);
                } catch (err) {
                  console.error('[PGO MapMods] Map callback failed:', err);
                }
              }

              try {
                W.dispatchEvent(new CustomEvent('pgo-mapmods:map-ready', {
                  detail: {
                    map,
                    source
                  },
                }));
              } catch (_) {}
            }

            return map;
          },

          getMap() {
            return api.activeMap || W.__pgoGoogleMap || api.maps[0] || null;
          },

          whenMapReady(callback) {
            const map = api.getMap();

            if (map) {
              callback(map);
              return;
            }

            api.callbacks.push(callback);
          },

          installGoogleHook() {
            if (api.hookInstalled) return;
            api.hookInstalled = true;

            function patchMapPrototype(MapCtor) {
              if (!MapCtor?.prototype || MapCtor.prototype.__pgoMapModsPatched) return;

              for (const method of [
                  'setCenter',
                  'setZoom',
                  'panTo',
                  'fitBounds',
                  'getCenter',
                  'getZoom',
                  'getBounds',
                  'getDiv',
                ]) {
                const original = MapCtor.prototype[method];
                if (typeof original !== 'function') continue;

                MapCtor.prototype[method] = function (...args) {
                  api.registerMap(this, `prototype.${method}`);
                  return original.apply(this, args);
                };
              }

              MapCtor.prototype.__pgoMapModsPatched = true;
            }

            function wrapMapConstructor(MapCtor) {
              if (!MapCtor) return MapCtor;

              // If another PGO plugin already wrapped it through this shared core,
              // do not wrap it again.
              if (MapCtor.__pgoMapModsWrapped) return MapCtor;

              patchMapPrototype(MapCtor);

              function WrappedMap(...args) {
                const map = Reflect.construct(MapCtor, args, new.target || WrappedMap);
                api.registerMap(map, 'constructor');
                return map;
              }

              Object.setPrototypeOf(WrappedMap, MapCtor);
              WrappedMap.prototype = MapCtor.prototype;

              for (const key of Reflect.ownKeys(MapCtor)) {
                if (key === 'prototype') continue;

                try {
                  Object.defineProperty(
                    WrappedMap,
                    key,
                    Object.getOwnPropertyDescriptor(MapCtor, key)
                  );
                } catch (_) {}
              }

              WrappedMap.__pgoMapModsWrapped = true;
              WrappedMap.__pgoMapModsOriginal = MapCtor;

              return WrappedMap;
            }

            function patchMapsObject(maps) {
              if (!maps || maps.__pgoMapModsPatched) return;

              let mapValue = maps.Map;

              Object.defineProperty(maps, 'Map', {
                configurable: true,
                enumerable: true,
                get() {
                  return mapValue;
                },
                set(value) {
                  mapValue = wrapMapConstructor(value);
                },
              });

              if (mapValue) {
                maps.Map = mapValue;
              }

              if (typeof maps.importLibrary === 'function' && !maps.importLibrary.__pgoMapModsPatched) {
                const originalImportLibrary = maps.importLibrary.bind(maps);

                maps.importLibrary = async function (...args) {
                  const lib = await originalImportLibrary(...args);

                  if (args[0] === 'maps' && lib?.Map) {
                    lib.Map = wrapMapConstructor(lib.Map);
                  }

                  return lib;
                };

                maps.importLibrary.__pgoMapModsPatched = true;
              }

              maps.__pgoMapModsPatched = true;
            }

            function patchGoogleObject(google) {
              if (!google || google.__pgoMapModsPatched) return;

              let mapsValue = google.maps;

              Object.defineProperty(google, 'maps', {
                configurable: true,
                enumerable: true,
                get() {
                  return mapsValue;
                },
                set(value) {
                  mapsValue = value;
                  patchMapsObject(mapsValue);
                },
              });

              if (mapsValue) {
                google.maps = mapsValue;
              }

              google.__pgoMapModsPatched = true;
            }

            let googleValue = W.google;

            Object.defineProperty(W, 'google', {
              configurable: true,
              enumerable: true,
              get() {
                return googleValue;
              },
              set(value) {
                googleValue = value;
                patchGoogleObject(googleValue);
              },
            });

            if (googleValue) {
              W.google = googleValue;
            }
          },
        };

        api.installGoogleHook();

        return api;
      }

      function attachMapListeners(map) {
        if (state.listenersAttached) return;

        const W = getPageWindow();

        if (!W.google?.maps?.event) return;

        state.listenersAttached = true;

        W.google.maps.event.addListener(map, 'idle', scheduleRedraw);
        W.google.maps.event.addListener(map, 'zoom_changed', scheduleRedraw);
        W.google.maps.event.addListener(map, 'bounds_changed', scheduleRedraw);
      }

      function scheduleRedraw() {
        clearTimeout(state.redrawTimer);

        state.redrawTimer = setTimeout(() => {
          redrawAllGrids().catch(err => {
            console.error('[PGO S2 Grid]', err);
          });
        }, CONFIG.redrawDebounceMs);
      }

      let PgoMapMods = null;

      function getActiveMap() {
        return PgoMapMods?.getMap?.() || null;
      }

      function boundsToBox(bounds) {
        const ne = bounds.getNorthEast();
        const sw = bounds.getSouthWest();

        let north = ne.lat();
        let south = sw.lat();
        let east = ne.lng();
        let west = sw.lng();

        const latPad = Math.max(0.0001, Math.abs(north - south) * CONFIG.viewportPaddingRatio);
        let lngSpan = east - west;

        // Normalise antimeridian-crossing bounds.
        if (lngSpan < 0) lngSpan += 360;

        const lngPad = Math.max(0.0001, lngSpan * CONFIG.viewportPaddingRatio);

        north = Math.min(90, north + latPad);
        south = Math.max(-90, south - latPad);
        east = wrapLng(east + lngPad);
        west = wrapLng(west - lngPad);

        return {
          north,
          south,
          east,
          west
        };
      }

      function wrapLng(lng) {
        return ((((lng + 180) % 360) + 360) % 360) - 180;
      }

      function lngInBox(lng, box) {
        lng = wrapLng(lng);

        if (box.west <= box.east) {
          return lng >= box.west && lng <= box.east;
        }

        // Crosses antimeridian.
        return lng >= box.west || lng <= box.east;
      }

      function pointInBox(latLng, box) {
        return latLng.lat >= box.south &&
          latLng.lat <= box.north &&
          lngInBox(latLng.lng, box);
      }

      function cellIntersectsBox(cell, box) {
        const corners = cell.getCornerLatLngs();
        const center = cell.getLatLng();

        if (pointInBox(center, box)) return true;
        if (corners.some(corner => pointInBox(corner, box))) return true;

        const cellNorth = Math.max(...corners.map(c => c.lat));
        const cellSouth = Math.min(...corners.map(c => c.lat));

        if (cellSouth > box.north || cellNorth < box.south) return false;

        // For ordinary viewports, this is enough. Antimeridian cases are rare but
        // still mostly handled by testing corners/center above.
        if (box.west <= box.east) {
          const lngs = corners.map(c => wrapLng(c.lng));
          const cellWest = Math.min(...lngs);
          const cellEast = Math.max(...lngs);

          return !(cellEast < box.west || cellWest > box.east);
        }

        return true;
      }

      function cellToGooglePath(cell) {
        return cell.getCornerLatLngs().map(corner => ({
          lat: corner.lat,
          lng: corner.lng,
        }));
      }

      function makeCellKey(cell) {
        return `${cell.level}:${cell.toHilbertQuadkey()}`;
      }

      function getVisibleCells(level, box, maxCells) {
        const map = getActiveMap();
        const center = map.getCenter();

        const start = S2.S2Cell.FromLatLng({
          lat: center.lat(),
          lng: center.lng(),
        }, level);

        const queue = [start];
        const queued = new Set([makeCellKey(start)]);
        const visible = [];

        while (queue.length && visible.length < maxCells) {
          const cell = queue.shift();
          const key = makeCellKey(cell);

          if (!cellIntersectsBox(cell, box)) continue;

          visible.push(cell);

          for (const neighbor of cell.getNeighbors()) {
            const neighborKey = makeCellKey(neighbor);

            if (queued.has(neighborKey)) continue;

            queued.add(neighborKey);
            queue.push(neighbor);
          }
        }

        if (queue.length) {
          console.warn(
            `[PGO S2 Grid] Hit max cell limit for L${level}. ` +
            `Visible=${visible.length}, Max=${maxCells}. Zoom in for full grid.`
          );
        }

        return visible;
      }

      function drawLevelGrid(levelConfig, box) {
        const map = getActiveMap();
        const W = getPageWindow();
        const maps = W.google?.maps;

        if (!map || !maps?.Polygon) return;

        const level = levelConfig.level;
        const existing = state.overlaysByLevel[level];
        const cells = getVisibleCells(level, box, levelConfig.maxCells);
        const wantedKeys = new Set();

        for (const cell of cells) {
          const key = makeCellKey(cell);
          wantedKeys.add(key);

          const path = cellToGooglePath(cell);

          if (existing.has(key)) {
            existing.get(key).setPath(path);
            continue;
          }

          const polygon = new maps.Polygon({
            paths: path,
            map,
            clickable: false,
            geodesic: true,
            fillOpacity: 0,
            strokeColor: levelConfig.strokeColor,
            strokeOpacity: levelConfig.strokeOpacity,
            strokeWeight: levelConfig.strokeWeight,
            zIndex: levelConfig.zIndex,
          });

          existing.set(key, polygon);
        }

        for (const [key, polygon] of existing.entries()) {
          if (!wantedKeys.has(key)) {
            polygon.setMap(null);
            existing.delete(key);
          }
        }
      }

      function clearLevelGrid(level) {
        const existing = state.overlaysByLevel[level];

        for (const polygon of existing.values()) {
          polygon.setMap(null);
        }

        existing.clear();
      }

      async function redrawAllGrids() {
        const map = getActiveMap();

        if (!map) return;

        const bounds = map.getBounds();
        const zoom = map.getZoom();

        if (!bounds || typeof zoom !== 'number') return;

        const box = boundsToBox(bounds);

        // Draw L17 first, lower zIndex.
        if (zoom >= CONFIG.L17.minZoom) {
          drawLevelGrid(CONFIG.L17, box);
        } else {
          clearLevelGrid(17);
        }

        // Draw L14 second, higher zIndex and thicker lines.
        if (zoom >= CONFIG.L14.minZoom) {
          drawLevelGrid(CONFIG.L14, box);
        } else {
          clearLevelGrid(14);
        }
      }

      // -----------------------------
      // S2 library
      // -----------------------------
      (function (exports) {
        'use strict';

        var S2 = exports.S2 = {
          L: {}
        };

        S2.L.LatLng = function ( /*Number*/ rawLat, /*Number*/ rawLng, /*Boolean*/ noWrap) {
          var lat = parseFloat(rawLat, 10);
          var lng = parseFloat(rawLng, 10);

          if (isNaN(lat) || isNaN(lng)) {
            throw new Error('Invalid LatLng object: (' + rawLat + ', ' + rawLng + ')');
          }

          if (noWrap !== true) {
            lat = Math.max(Math.min(lat, 90), -90); // clamp latitude into -90..90
            lng = (lng + 180) % 360 + ((lng < -180 || lng === 180) ? 180 : -180); // wrap longtitude into -180..180
          }

          return {
            lat: lat,
            lng: lng
          };
        };

        S2.L.LatLng.DEG_TO_RAD = Math.PI / 180;
        S2.L.LatLng.RAD_TO_DEG = 180 / Math.PI;

        S2.LatLngToXYZ = function (latLng) {
          var d2r = S2.L.LatLng.DEG_TO_RAD;

          var phi = latLng.lat * d2r;
          var theta = latLng.lng * d2r;

          var cosphi = Math.cos(phi);

          return [Math.cos(theta) * cosphi, Math.sin(theta) * cosphi, Math.sin(phi)];
        };

        S2.XYZToLatLng = function (xyz) {
          var r2d = S2.L.LatLng.RAD_TO_DEG;

          var lat = Math.atan2(xyz[2], Math.sqrt(xyz[0] * xyz[0] + xyz[1] * xyz[1]));
          var lng = Math.atan2(xyz[1], xyz[0]);

          return S2.L.LatLng(lat * r2d, lng * r2d);
        };

        var largestAbsComponent = function (xyz) {
          var temp = [Math.abs(xyz[0]), Math.abs(xyz[1]), Math.abs(xyz[2])];

          if (temp[0] > temp[1]) {
            if (temp[0] > temp[2]) {
              return 0;
            } else {
              return 2;
            }
          } else {
            if (temp[1] > temp[2]) {
              return 1;
            } else {
              return 2;
            }
          }

        };

        var faceXYZToUV = function (face, xyz) {
          var u, v;

          switch (face) {
          case 0:
            u = xyz[1] / xyz[0];
            v = xyz[2] / xyz[0];
            break;
          case 1:
            u = -xyz[0] / xyz[1];
            v = xyz[2] / xyz[1];
            break;
          case 2:
            u = -xyz[0] / xyz[2];
            v = -xyz[1] / xyz[2];
            break;
          case 3:
            u = xyz[2] / xyz[0];
            v = xyz[1] / xyz[0];
            break;
          case 4:
            u = xyz[2] / xyz[1];
            v = -xyz[0] / xyz[1];
            break;
          case 5:
            u = -xyz[1] / xyz[2];
            v = -xyz[0] / xyz[2];
            break;
          default:
            throw {
              error: 'Invalid face'
            };
          }

          return [u, v];
        };

        S2.XYZToFaceUV = function (xyz) {
          var face = largestAbsComponent(xyz);

          if (xyz[face] < 0) {
            face += 3;
          }

          var uv = faceXYZToUV(face, xyz);

          return [face, uv];
        };

        S2.FaceUVToXYZ = function (face, uv) {
          var u = uv[0];
          var v = uv[1];

          switch (face) {
          case 0:
            return [1, u, v];
          case 1:
            return [-u, 1, v];
          case 2:
            return [-u, -v, 1];
          case 3:
            return [-1, -v, -u];
          case 4:
            return [v, -1, -u];
          case 5:
            return [v, u, -1];
          default:
            throw {
              error: 'Invalid face'
            };
          }
        };

        var singleSTtoUV = function (st) {
          if (st >= 0.5) {
            return (1 / 3.0) * (4 * st * st - 1);
          } else {
            return (1 / 3.0) * (1 - (4 * (1 - st) * (1 - st)));
          }
        };

        S2.STToUV = function (st) {
          return [singleSTtoUV(st[0]), singleSTtoUV(st[1])];
        };

        var singleUVtoST = function (uv) {
          if (uv >= 0) {
            return 0.5 * Math.sqrt(1 + 3 * uv);
          } else {
            return 1 - 0.5 * Math.sqrt(1 - 3 * uv);
          }
        };
        S2.UVToST = function (uv) {
          return [singleUVtoST(uv[0]), singleUVtoST(uv[1])];
        };

        S2.STToIJ = function (st, order) {
          var maxSize = (1 << order);

          var singleSTtoIJ = function (st) {
            var ij = Math.floor(st * maxSize);
            return Math.max(0, Math.min(maxSize - 1, ij));
          };

          return [singleSTtoIJ(st[0]), singleSTtoIJ(st[1])];
        };

        S2.IJToST = function (ij, order, offsets) {
          var maxSize = (1 << order);

          return [
            (ij[0] + offsets[0]) / maxSize,
            (ij[1] + offsets[1]) / maxSize
          ];
        };

        var rotateAndFlipQuadrant = function (n, point, rx, ry) {
          var newX, newY;
          if (ry == 0) {
            if (rx == 1) {
              point.x = n - 1 - point.x;
              point.y = n - 1 - point.y

            }

            var x = point.x;
            point.x = point.y
            point.y = x;
          }

        }

        // hilbert space-filling curve
        // based on http://blog.notdot.net/2009/11/Damn-Cool-Algorithms-Spatial-indexing-with-Quadtrees-and-Hilbert-Curves
        // note: rather than calculating the final integer hilbert position, we just return the list of quads
        // this ensures no precision issues with large orders (S3 cell IDs use up to 30), and is more
        // convenient for pulling out the individual bits as needed later
        var pointToHilbertQuadList = function (x, y, order, face) {
          var hilbertMap = {
            'a': [
              [0, 'd'],
              [1, 'a'],
              [3, 'b'],
              [2, 'a']
            ],
            'b': [
              [2, 'b'],
              [1, 'b'],
              [3, 'a'],
              [0, 'c']
            ],
            'c': [
              [2, 'c'],
              [3, 'd'],
              [1, 'c'],
              [0, 'b']
            ],
            'd': [
              [0, 'a'],
              [3, 'c'],
              [1, 'd'],
              [2, 'd']
            ]
          };

          if ('number' !== typeof face) {
            console.warn(new Error("called pointToHilbertQuadList without face value, defaulting to '0'").stack);
          }
          var currentSquare = (face % 2) ? 'd' : 'a';
          var positions = [];

          for (var i = order - 1; i >= 0; i--) {

            var mask = 1 << i;

            var quad_x = x & mask ? 1 : 0;
            var quad_y = y & mask ? 1 : 0;

            var t = hilbertMap[currentSquare][quad_x * 2 + quad_y];

            positions.push(t[0]);

            currentSquare = t[1];
          }

          return positions;
        };

        // S2Cell class

        S2.S2Cell = function () {};

        S2.S2Cell.FromHilbertQuadKey = function (hilbertQuadkey) {
          var parts = hilbertQuadkey.split('/');
          var face = parseInt(parts[0]);
          var position = parts[1];
          var maxLevel = position.length;
          var point = {
            x: 0,
            y: 0
          };
          var i;
          var level;
          var bit;
          var rx, ry;
          var val;

          for (i = maxLevel - 1; i >= 0; i--) {

            level = maxLevel - i;
            bit = position[i];
            rx = 0;
            ry = 0;
            if (bit === '1') {
              ry = 1;
            } else if (bit === '2') {
              rx = 1;
              ry = 1;
            } else if (bit === '3') {
              rx = 1;
            }

            val = Math.pow(2, level - 1);
            rotateAndFlipQuadrant(val, point, rx, ry);

            point.x += val * rx;
            point.y += val * ry;

          }

          if (face % 2 === 1) {
            var t = point.x;
            point.x = point.y;
            point.y = t;
          }

          return S2.S2Cell.FromFaceIJ(parseInt(face), [point.x, point.y], level);
        };

        //static method to construct
        S2.S2Cell.FromLatLng = function (latLng, level) {
          if ((!latLng.lat && latLng.lat !== 0) || (!latLng.lng && latLng.lng !== 0)) {
            throw new Error("Pass { lat: lat, lng: lng } to S2.S2Cell.FromLatLng");
          }
          var xyz = S2.LatLngToXYZ(latLng);

          var faceuv = S2.XYZToFaceUV(xyz);
          var st = S2.UVToST(faceuv[1]);

          var ij = S2.STToIJ(st, level);

          return S2.S2Cell.FromFaceIJ(faceuv[0], ij, level);
        };

        S2.S2Cell.FromFaceIJ = function (face, ij, level) {
          var cell = new S2.S2Cell();
          cell.face = face;
          cell.ij = ij;
          cell.level = level;

          return cell;
        };

        S2.S2Cell.prototype.toString = function () {
          return 'F' + this.face + 'ij[' + this.ij[0] + ',' + this.ij[1] + ']@' + this.level;
        };

        S2.S2Cell.prototype.getLatLng = function () {
          var st = S2.IJToST(this.ij, this.level, [0.5, 0.5]);
          var uv = S2.STToUV(st);
          var xyz = S2.FaceUVToXYZ(this.face, uv);

          return S2.XYZToLatLng(xyz);
        };

        S2.S2Cell.prototype.getCornerLatLngs = function () {
          var result = [];
          var offsets = [
            [0.0, 0.0],
            [0.0, 1.0],
            [1.0, 1.0],
            [1.0, 0.0]
          ];

          for (var i = 0; i < 4; i++) {
            var st = S2.IJToST(this.ij, this.level, offsets[i]);
            var uv = S2.STToUV(st);
            var xyz = S2.FaceUVToXYZ(this.face, uv);

            result.push(S2.XYZToLatLng(xyz));
          }
          return result;
        };

        S2.S2Cell.prototype.getFaceAndQuads = function () {
          var quads = pointToHilbertQuadList(this.ij[0], this.ij[1], this.level, this.face);

          return [this.face, quads];
        };
        S2.S2Cell.prototype.toHilbertQuadkey = function () {
          var quads = pointToHilbertQuadList(this.ij[0], this.ij[1], this.level, this.face);

          return this.face.toString(10) + '/' + quads.join('');
        };

        S2.latLngToNeighborKeys = S2.S2Cell.latLngToNeighborKeys = function (lat, lng, level) {
          return S2.S2Cell.FromLatLng({
            lat: lat,
            lng: lng
          }, level).getNeighbors().map(function (cell) {
            return cell.toHilbertQuadkey();
          });
        };
        S2.S2Cell.prototype.getNeighbors = function () {

          var fromFaceIJWrap = function (face, ij, level) {
            var maxSize = (1 << level);
            if (ij[0] >= 0 && ij[1] >= 0 && ij[0] < maxSize && ij[1] < maxSize) {
              // no wrapping out of bounds
              return S2.S2Cell.FromFaceIJ(face, ij, level);
            } else {
              // the new i,j are out of range.
              // with the assumption that they're only a little past the borders we can just take the points as
              // just beyond the cube face, project to XYZ, then re-create FaceUV from the XYZ vector

              var st = S2.IJToST(ij, level, [0.5, 0.5]);
              var uv = S2.STToUV(st);
              var xyz = S2.FaceUVToXYZ(face, uv);
              var faceuv = S2.XYZToFaceUV(xyz);
              face = faceuv[0];
              uv = faceuv[1];
              st = S2.UVToST(uv);
              ij = S2.STToIJ(st, level);
              return S2.S2Cell.FromFaceIJ(face, ij, level);
            }
          };

          var face = this.face;
          var i = this.ij[0];
          var j = this.ij[1];
          var level = this.level;

          return [
            fromFaceIJWrap(face, [i - 1, j], level),
            fromFaceIJWrap(face, [i, j - 1], level),
            fromFaceIJWrap(face, [i + 1, j], level),
            fromFaceIJWrap(face, [i, j + 1], level)
          ];

        };

        //
        // Functional Style
        //
        S2.FACE_BITS = 3;
        S2.MAX_LEVEL = 30;
        S2.POS_BITS = (2 * S2.MAX_LEVEL) + 1; // 61 (60 bits of data, 1 bit lsb marker)

        S2.facePosLevelToId = S2.S2Cell.facePosLevelToId = S2.fromFacePosLevel = function (faceN, posS, levelN) {
          var Long = exports.dcodeIO && exports.dcodeIO.Long || require('long');
          var faceB;
          var posB;
          var bin;

          if (!levelN) {
            levelN = posS.length;
          }
          if (posS.length > levelN) {
            posS = posS.substr(0, levelN);
          }

          // 3-bit face value
          faceB = Long.fromString(faceN.toString(10), true, 10).toString(2);
          while (faceB.length < S2.FACE_BITS) {
            faceB = '0' + faceB;
          }

          // 60-bit position value
          posB = Long.fromString(posS, true, 4).toString(2);
          while (posB.length < (2 * levelN)) {
            posB = '0' + posB;
          }

          bin = faceB + posB;
          // 1-bit lsb marker
          bin += '1';
          // n-bit padding to 64-bits
          while (bin.length < (S2.FACE_BITS + S2.POS_BITS)) {
            bin += '0';
          }

          return Long.fromString(bin, true, 2).toString(10);
        };

        S2.keyToId = S2.S2Cell.keyToId = S2.toId = S2.toCellId = S2.fromKey = function (key) {
          var parts = key.split('/');

          return S2.fromFacePosLevel(parts[0], parts[1], parts[1].length);
        };

        S2.idToKey = S2.S2Cell.idToKey = S2.S2Cell.toKey = S2.toKey = S2.fromId = S2.fromCellId = S2.S2Cell
          .toHilbertQuadkey = S2.toHilbertQuadkey = function (idS) {
            var Long = exports.dcodeIO && exports.dcodeIO.Long || require('long');
            var bin = Long.fromString(idS, true, 10).toString(2);

            while (bin.length < (S2.FACE_BITS + S2.POS_BITS)) {
              bin = '0' + bin;
            }

            // MUST come AFTER binstr has been left-padded with '0's
            var lsbIndex = bin.lastIndexOf('1');
            // substr(start, len)
            // substring(start, end) // includes start, does not include end
            var faceB = bin.substring(0, 3);
            // posB will always be a multiple of 2 (or it's invalid)
            var posB = bin.substring(3, lsbIndex);
            var levelN = posB.length / 2;

            var faceS = Long.fromString(faceB, true, 2).toString(10);
            var posS = Long.fromString(posB, true, 2).toString(4);

            while (posS.length < levelN) {
              posS = '0' + posS;
            }

            return faceS + '/' + posS;
          };

        S2.keyToLatLng = S2.S2Cell.keyToLatLng = function (key) {
          var cell2 = S2.S2Cell.FromHilbertQuadKey(key);
          return cell2.getLatLng();
        };

        S2.idToLatLng = S2.S2Cell.idToLatLng = function (id) {
          var key = S2.idToKey(id);
          return S2.keyToLatLng(key);
        };

        S2.S2Cell.latLngToKey = S2.latLngToKey = S2.latLngToQuadkey = function (lat, lng, level) {
          if (isNaN(level) || level < 1 || level > 30) {
            throw new Error("'level' is not a number between 1 and 30 (but it should be)");
          }
          return S2.S2Cell.FromLatLng({
            lat: lat,
            lng: lng
          }, level).toHilbertQuadkey();
        };

        S2.stepKey = function (key, num) {
          var Long = exports.dcodeIO && exports.dcodeIO.Long || require('long');
          var parts = key.split('/');

          var faceS = parts[0];
          var posS = parts[1];
          var level = parts[1].length;

          var posL = Long.fromString(posS, true, 4);
          // TODO handle wrapping (0 === pos + 1)
          // (only on the 12 edges of the globe)
          var otherL;
          if (num > 0) {
            otherL = posL.add(Math.abs(num));
          } else if (num < 0) {
            otherL = posL.subtract(Math.abs(num));
          }
          var otherS = otherL.toString(4);

          if ('0' === otherS) {
            console.warning(new Error("face/position wrapping is not yet supported"));
          }

          while (otherS.length < level) {
            otherS = '0' + otherS;
          }

          return faceS + '/' + otherS;
        };

        S2.S2Cell.prevKey = S2.prevKey = function (key) {
          return S2.stepKey(key, -1);
        };

        S2.S2Cell.nextKey = S2.nextKey = function (key) {
          return S2.stepKey(key, 1);
        };

      })('undefined' !== typeof module ? module.exports : window);

      // -----------------------------
      // Bootstrap
      // -----------------------------

      function bootstrapS2Grid() {
        PgoMapMods = getPgoMapMods();

        PgoMapMods.whenMapReady(map => {
          attachMapListeners(map);
          scheduleRedraw();
        });

        const existingMap = PgoMapMods.getMap();
        if (existingMap) {
          attachMapListeners(existingMap);
          scheduleRedraw();
        }
      }

      bootstrapS2Grid();

    })();
  } finally {
    // Restore everything after the script finishes executing
    for (const name of blocked) {
      try {
        window[name] = originals[name];
      } catch {}
    }

    if (originalBeacon) {
      try {
        navigator.sendBeacon = originalBeacon;
      } catch {}
    }

    for (const name of rtcConstructors) {
      if (rtcOriginals[name]) {
        try {
          window[name] = rtcOriginals[name];
        } catch {}
      }
    }
  }
})();
