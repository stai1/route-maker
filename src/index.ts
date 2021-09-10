import 'ol/ol.css';
import { OSM } from 'ol/source';
import { Map, View, Feature, MapBrowserEvent } from 'ol';
import { MousePosition, ScaleLine, ZoomToExtent, defaults } from 'ol/control';
import { Coordinate, createStringXY } from 'ol/coordinate';
import { Geometry, LineString, Point } from 'ol/geom'
import { Tile , Vector } from 'ol/layer';
import VectorSource from 'ol/source/Vector';
import { fromLonLat, toLonLat } from 'ol/proj';
import { getDistance } from 'ol/sphere';
import { Style, Stroke, Circle, Fill} from 'ol/style';

interface ExportOptions {
  name: string;
  bogusTime: boolean;
}

interface MapDataPoint {
  point: Point;
  data: DataPoint;
}

interface DataPoint {
  distance: number;
  totalDistance: number;
}

const EDITOR_LINE_STYLE = new Style({
  stroke: new Stroke({
    color: '#ff0000',
    width:3
  })
});
const EDITOR_POINTS_STYLE = new Style({
  image: new Circle({
    radius:5,
    fill: new Fill({
      color: '#ffffff'
    }),
    stroke: new Stroke({
      color: '#ff0000',
      width:2
    })
  })
});
const EDITOR_POINTS_PREVIOUS_STYLE = new Style({
  image: new Circle({
    radius:5,
    fill: new Fill({
      color: '#00ff00'
    }),
    stroke: new Stroke({
      color: '#ff0000',
      width:2
    })
  })
});
export class RouteMaker {

  routeLayerSource = new VectorSource({wrapX: true});
  selectedLayerSource = new VectorSource({wrapX: true});
  editorLineLayerSource = new VectorSource({wrapX: true});
  editorPointsLayerSource = new VectorSource({wrapX: true});


  editorLineFeature: Feature<LineString> = new Feature<LineString>({geometry: new LineString([])});
  editorPoints: MapDataPoint[];
  previousPointIndex: number;

  draggingPointIndex: number;
  map: Map;
  constructor() {
    let mapSource = new OSM();
    let ele = document.createElement('div');
    ele.textContent = "abc";

    this.map = new Map({
      target: 'map',
      controls: defaults().extend([
        new MousePosition({
          coordinateFormat: createStringXY(5),
          projection: 'EPSG:4326',
        }),
        new ScaleLine(),
        new ZoomToExtent(),
      ]),
      layers: [
        new Tile({source: mapSource}),
        new Vector({ source: this.routeLayerSource}),
        new Vector({ source: this.selectedLayerSource}),
        new Vector({ source: this.editorLineLayerSource}),
        new Vector({ source: this.editorPointsLayerSource})
      ],
      view: new View({
        center: fromLonLat([-121.961, 37.55]),
        zoom: 16,
      }),
    });
    this.editorLineFeature.setStyle(EDITOR_LINE_STYLE);
    this.editorLineLayerSource.addFeature(this.editorLineFeature);

    this.resetEditor();
    this.initEditor();

    this.setInteractions();
  }

  private resetEditor() {
    this.editorPoints = [];
    this.previousPointIndex = -1;
    this.draggingPointIndex = null;
    this.updateDisplay();
  }

  private setInteractions() {
    let controlInteractions = {
      editor: {
        click: (e: MapBrowserEvent<MouseEvent>) => {
          let coordinate = e.coordinate;
          if(e.originalEvent.ctrlKey) {
            this.map.forEachFeatureAtPixel(e.pixel, (f) => {
              if(this.editorPointsLayerSource.hasFeature(f as Feature<Geometry>)) {
                coordinate = (<Point> f.getGeometry()).getCoordinates();
                return true;
              }
            });
          }
          this.addPoint(coordinate);
        },
        dblclick: (e: MapBrowserEvent<MouseEvent>) => {
          e.stopPropagation();
        },
        rightclick: (e: MapBrowserEvent<MouseEvent>) => {
          this.removePreviousPoint();
        },
        pointerdown: (e: MapBrowserEvent<MouseEvent>) => {
          if(!e.originalEvent.ctrlKey) { // ctrlKey to allow adding point on another point
            this.map.forEachFeatureAtPixel(e.pixel, (f) => {
              if(this.editorPointsLayerSource.hasFeature(f as Feature<Geometry>)) {
                this.previousPointIndex = this.editorPoints.findIndex(item => item.point === <Point> f.getGeometry());
                this.draggingPointIndex = this.previousPointIndex;
                this.setPreviousPointStyle();
                return true;
              }
            });
          }
        },
        pointerup: (e: MapBrowserEvent<MouseEvent>) => {
          if(this.draggingPointIndex != null) {
            e.preventDefault();
            this.draggingPointIndex = null;
          }
        },
        pointerdrag: (e: MapBrowserEvent<MouseEvent>) => {
          if(this.draggingPointIndex != null) {
            e.stopPropagation();
            let coordinate = e.coordinate;
            if(e.originalEvent.ctrlKey) {
              this.map.forEachFeatureAtPixel(e.pixel, (f) => {
                if(this.editorPointsLayerSource.hasFeature(f as Feature<Geometry>) && <Point> f.getGeometry() !== this.editorPoints[this.draggingPointIndex].point) {
                  coordinate = (<Point> f.getGeometry()).getCoordinates();
                  return true;
                }
              });
            }
            this.moveDraggingPoint(coordinate);
          }
        }
      }
    }
    this.map.on('click', (e: MapBrowserEvent<MouseEvent>) => {
      controlInteractions.editor.click?.(e);
    });
    this.map.on('dblclick', (e: MapBrowserEvent<MouseEvent>) => {
      controlInteractions.editor.dblclick?.(e);
    });
    this.map.on(<any> 'contextmenu', (e: MapBrowserEvent<MouseEvent>) => {
      e.preventDefault();
      controlInteractions.editor.rightclick?.(e);
    });
    this.map.on(<any> 'pointerdown', (e: MapBrowserEvent<MouseEvent>) => {
      controlInteractions.editor.pointerdown?.(e);
    });
    this.map.on(<any> 'pointerup', (e: MapBrowserEvent<MouseEvent>) => {
      controlInteractions.editor.pointerup?.(e);
    });
    this.map.on('pointerdrag', (e: MapBrowserEvent<MouseEvent>) => {
      controlInteractions.editor.pointerdrag?.(e);
    });
  }

  /**
   * Update the total distances of points from a starting index. Assumes that `distance` is correct for all data
   * @param index the index of the last point with a correct `totalDistance`
   */
  private updateTotalDistances(index: number) {
    for(let i = index + 1; i < this.editorPoints.length; ++i) {
      const dataPoint = this.editorPoints[i].data;
      dataPoint.totalDistance = (this.editorPoints[i-1]?.data.totalDistance || 0) + dataPoint.distance;
    }
  }

  /**
   * Add a point at `previousPointIndex` at a location
   * @param coordinate 
   * @param render whether to render the path update
   */
  private addPoint(coordinate: Coordinate, render = true) {
    let point = new Point(coordinate);
    let distance = 0;
    let totalDistance = 0;

    let nextPointDistance: number;
    if(this.previousPointIndex !== -1) {
      const mapDataPoint = this.editorPoints[this.previousPointIndex];
      distance = getDistance(toLonLat(mapDataPoint.point.getCoordinates()), toLonLat(coordinate));
      totalDistance = mapDataPoint.data.totalDistance + distance;

      if(this.previousPointIndex < this.editorPoints.length - 1) {
        nextPointDistance = getDistance(toLonLat(coordinate), toLonLat(this.editorPoints[this.previousPointIndex+1].point.getCoordinates()));
        this.editorPoints[this.previousPointIndex+1].data.distance = nextPointDistance;
      }
    }
    this.editorPoints.splice(this.previousPointIndex + 1, 0,
      { 
        point: point, 
        data: {
          distance: distance,
          totalDistance: totalDistance
        }
      }
    );
    this.previousPointIndex += 1;
    this.updateTotalDistances(this.previousPointIndex);
    if(render) {
      this.updateDisplay();
    }
  }

  /**
   * Remove a point at `previousPointIndex`
   * @param render whether to render the path update
   */
  private removePreviousPoint(render = true) {
    if(this.previousPointIndex > 0) {
      this.editorPoints.splice(this.previousPointIndex, 1);
      const mapDataPoint = this.editorPoints[this.previousPointIndex];
      if(this.previousPointIndex < this.editorPoints.length) {
        mapDataPoint.data.distance = getDistance(toLonLat(this.editorPoints[this.previousPointIndex-1].point.getCoordinates()), toLonLat(mapDataPoint.point.getCoordinates()));
      }
      this.previousPointIndex -= 1;
      this.updateTotalDistances(this.previousPointIndex);
    }
    else if(this.previousPointIndex === 0) {
      this.editorPoints.shift();
      if(!this.editorPoints.length) {
        this.previousPointIndex = -1;
      }
      else {
        this.editorPoints[this.previousPointIndex].data.distance = 0;
        this.updateTotalDistances(-1);
      }
    }
    if(render) {
      this.updateDisplay();
    }
  }

  /**
   * Move the point at `draggingPointIndex` to a new location
   * @param coordinate 
   * @param render whether to render the path update
   */
  private moveDraggingPoint(coordinate: Coordinate, render = true) {
    const mapDataPoint = this.editorPoints[this.draggingPointIndex];
    mapDataPoint.point.setCoordinates(coordinate);
    if(this.draggingPointIndex !== 0) {
      const previousMapDataPoint = this.editorPoints[this.draggingPointIndex-1]
      mapDataPoint.data.distance = getDistance(toLonLat(previousMapDataPoint.point.getCoordinates()), toLonLat(coordinate));
      mapDataPoint.data.totalDistance = previousMapDataPoint.data.totalDistance + mapDataPoint.data.distance;
    }
    if(this.draggingPointIndex < this.editorPoints.length - 1) {
      const nextMapDataPoint = this.editorPoints[this.draggingPointIndex+1];
      nextMapDataPoint.data.distance = getDistance(toLonLat(mapDataPoint.point.getCoordinates()), toLonLat(nextMapDataPoint.point.getCoordinates()));
    }
    this.updateTotalDistances(this.draggingPointIndex);
    if(render) {
      this.updateDisplay();
    }
  }

  /**
   * Update all visual content
   */
  private updateDisplay() {
    this.setEditorPath(this.editorPoints);
    this.setPreviousPointStyle();
    this.setDistanceText();
  }

  private setEditorPath(points: MapDataPoint[]) {
    let coords = this.editorPoints.map(item => item.point.getCoordinates());
    this.editorLineFeature.getGeometry().setCoordinates(coords);
    this.editorPointsLayerSource.clear();
    this.editorPointsLayerSource.addFeatures(
      this.editorPoints.map(item => {
        let feature = new Feature({geometry: item.point});
        feature.setStyle(EDITOR_POINTS_STYLE);
        return feature;
      })
    );
  }

  private setPreviousPointStyle() {
    this.editorPointsLayerSource.forEachFeature((f: Feature<Geometry>) => {
      if(<Point> f.getGeometry() === this.editorPoints[this.previousPointIndex].point)
        f.setStyle(EDITOR_POINTS_PREVIOUS_STYLE);
      else if(f.getStyle() !== EDITOR_POINTS_STYLE)
        f.setStyle(EDITOR_POINTS_STYLE);
    });
  }

  private setDistanceText() {
    const distance = this.editorPoints[this.editorPoints.length-1]?.data.totalDistance || 0;
    document.getElementById('distance-km').textContent = (distance/1000).toString();
    document.getElementById('distance-miles').textContent = (distance/1609.344).toString();
  }

  public reversePath() {
    const reversed: MapDataPoint[] = [];
    for(let i = this.editorPoints.length - 1; i >= 0; --i) {
      reversed.push(this.editorPoints[i]);
    }
    reversed[0].data.distance = 0;
    reversed[0].data.totalDistance = 0;
    for(let i = 1; i < reversed.length; ++i) {
      const previousMapDataPoint = reversed[i-1];
      const mapDataPoint = reversed[i];
      mapDataPoint.data.distance = getDistance(toLonLat(previousMapDataPoint.point.getCoordinates()), toLonLat(mapDataPoint.point.getCoordinates()));
      mapDataPoint.data.totalDistance = previousMapDataPoint.data.totalDistance + mapDataPoint.data.distance;
    }
    this.editorPoints = reversed;
    this.previousPointIndex = this.editorPoints.length - 1 - this.previousPointIndex;
    this.updateDisplay();
  }

  private initEditor() {
    this.editorPoints = [];
    this.previousPointIndex = -1;
  }

  private cancelEditor(): boolean {
    this.resetEditor();
    return true;
  }

  public loadGPX(fileContents: string) {
    const domParser = new DOMParser();
    const xmlDoc = domParser.parseFromString(fileContents, 'text/xml');
    const name = xmlDoc.getElementsByTagName('metadata')[0]?.getElementsByTagName('name')[0]?.textContent;
    const formElement = document.getElementById('export') as HTMLFormElement;

    const oldPoints = this.editorPoints;
    const oldPreviousPointIndex = this.previousPointIndex;
    const oldName: string = formElement.elements['name'].value;
    try {
      this.resetEditor();
      for(const trkpt of xmlDoc.getElementsByTagName('trkpt')) {
        this.addPoint(
          fromLonLat([parseFloat(trkpt.getAttribute('lon')), parseFloat(trkpt.getAttribute('lat'))]),
          false
        );
      }
  
      formElement.elements['name'].value = name;
  
      this.updateDisplay();
      this.map.getView().fit(this.editorLineLayerSource.getExtent()); 
    }
    catch(error) {
      this.editorPoints = oldPoints;
      this.previousPointIndex = oldPreviousPointIndex;
      formElement.elements['name'].value = oldName;
      this.updateDisplay();
      alert("File import failed");
    }
  }

  public createGPX(options: ExportOptions): string {
    const timeRegex = /(.*)\..*?Z/;

    const xmlDoc = document.implementation.createDocument(null, 'gpx', null);
    const gpxElement: Element = xmlDoc.documentElement;
    let time = new Date();
    time.setMilliseconds(0);
    if(options.bogusTime) {
      gpxElement
        .appendChild(xmlDoc.createElement('metadata'))
        .appendChild(xmlDoc.createElement('time'))
        .textContent = time.toISOString().match(timeRegex)[1]+'Z';
    }
    const trkElement: Element = gpxElement.appendChild(xmlDoc.createElement('trk'));
    trkElement.appendChild(xmlDoc.createElement('name')).textContent = options.name;
    if(options.bogusTime) {
      trkElement.appendChild(xmlDoc.createElement('type')).textContent = '9';
    }
    const trksegElement: Element = trkElement.appendChild(xmlDoc.createElement('trkseg'));
    for(const mapDataPoint of this.editorPoints) {
      const trkptElement: Element = trksegElement.appendChild(xmlDoc.createElement('trkpt'));
      const coordinates = toLonLat(mapDataPoint.point.getCoordinates());
      trkptElement.setAttribute('lat', coordinates[1].toString());
      trkptElement.setAttribute('lon', coordinates[0].toString());
      if(options.bogusTime) {
        const seconds = Math.ceil(mapDataPoint.data.distance); // at most 1 m/s
        time = new Date(time.getTime() + seconds*1000);
        trkptElement.appendChild(xmlDoc.createElement('time'))
          .textContent = time.toISOString().match(timeRegex)[1]+'Z';
      }
    }
    return '<?xml version="1.0" encoding="UTF-8"?>' + new XMLSerializer().serializeToString(xmlDoc);
  }

}

const app = new RouteMaker();

document.getElementById('reverse').addEventListener('click', () => {
  app.reversePath();
});

document.getElementById('import').addEventListener('click', () => {
  document.getElementById('import-input').click();
});

const importInput = document.getElementById('import-input') as HTMLInputElement;
importInput.addEventListener('change', (event) =>{
  const reader = new FileReader();
  reader.onload = event => {
    app.loadGPX(event.target.result as string);
  };
  reader.readAsText((<HTMLInputElement> event.target).files[0]);
});

const formElement = document.getElementById('export') as HTMLFormElement;
formElement.addEventListener('submit', (ev: Event) => {
  const options = {
    bogusTime: formElement.elements['bogus-time'].checked as boolean,
    name: formElement.elements['name'].value as string,
  };
  console.log(options);

  const blob = new Blob([app.createGPX(options)], {type: "octet/stream"});

  const downloadElement = document.getElementById('download') as HTMLAnchorElement;
  downloadElement.href = window.URL.createObjectURL(blob);
  downloadElement.download = (options.name || 'route') + '.gpx';
  downloadElement.click();
});