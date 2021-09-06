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

interface MapDataPoint {
  point: Point;
  data: DataPoint;
}

interface DataPoint {
  distance: number;
  totalDistance: number;
}

const PATCH_LINE_STYLE = new Style({
  stroke: new Stroke({
    color: '#ff0000',
    width:3
  })
});
const PATCH_POINTS_STYLE = new Style({
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
const PATCH_POINTS_PREVIOUS_STYLE = new Style({
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
export class RunPatcher {

  routeLayerSource = new VectorSource({wrapX: true});
  selectedLayerSource = new VectorSource({wrapX: true});
  patchLineLayerSource = new VectorSource({wrapX: true});
  patchPointsLayerSource = new VectorSource({wrapX: true});


  patchLineFeature: Feature<LineString> = new Feature<LineString>({geometry: new LineString([])});
  patchPoints: MapDataPoint[];
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
        new Vector({ source: this.patchLineLayerSource}),
        new Vector({ source: this.patchPointsLayerSource})
      ],
      view: new View({
        center: fromLonLat([-121.961, 37.55]),
        zoom: 16,
      }),
    });
    this.patchLineFeature.setStyle(PATCH_LINE_STYLE);
    this.patchLineLayerSource.addFeature(this.patchLineFeature);

    this.resetPatcher();
    this.initPatcher();

    this.setInteractions();
  }

  private resetPatcher() {
    this.patchPoints = [];
    this.previousPointIndex = null;
    this.draggingPointIndex = null;
    this.setPatchPath(this.patchPoints);
  }

  private setInteractions() {
    let controlInteractions = {
      patcher: {
        click: (e: MapBrowserEvent<MouseEvent>) => {
          this.map.forEachFeatureAtPixel(e.pixel, (f) => {
            if(this.patchPointsLayerSource.hasFeature(f as Feature<Geometry>)) {
              this.previousPointIndex = this.patchPoints.findIndex(item => item.point === <Point> f.getGeometry());
              return true;
            }
          });
          this.addPoint(e.coordinate);
        },
        dblclick: (e: MapBrowserEvent<MouseEvent>) => {
          e.stopPropagation();
        },
        rightclick: (e: MapBrowserEvent<MouseEvent>) => {
          this.removePreviousPoint();
        },
        pointerdown: (e: MapBrowserEvent<MouseEvent>) => {
          this.map.forEachFeatureAtPixel(e.pixel, (f) => {
            if(this.patchPointsLayerSource.hasFeature(f as Feature<Geometry>)) {
              this.previousPointIndex = this.patchPoints.findIndex(item => item.point === <Point> f.getGeometry());
              this.draggingPointIndex = this.previousPointIndex;
              this.setPreviousPointStyle();
              return true;
            }
          });
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
            this.moveDraggingPoint(e.coordinate);
          }
        }
      }
    }
    this.map.on('click', (e: MapBrowserEvent<MouseEvent>) => {
      controlInteractions.patcher.click?.(e);
    });
    this.map.on('dblclick', (e: MapBrowserEvent<MouseEvent>) => {
      controlInteractions.patcher.dblclick?.(e);
    });
    this.map.on(<any> 'contextmenu', (e: MapBrowserEvent<MouseEvent>) => {
      e.preventDefault();
      controlInteractions.patcher.rightclick?.(e);
    });
    this.map.on(<any> 'pointerdown', (e: MapBrowserEvent<MouseEvent>) => {
      controlInteractions.patcher.pointerdown?.(e);
    });
    this.map.on(<any> 'pointerup', (e: MapBrowserEvent<MouseEvent>) => {
      controlInteractions.patcher.pointerup?.(e);
    });
    this.map.on('pointerdrag', (e: MapBrowserEvent<MouseEvent>) => {
      controlInteractions.patcher.pointerdrag?.(e);
    });
  }

  private setPatchPath(points: MapDataPoint[]) {
    let coords = this.patchPoints.map(item => item.point.getCoordinates());
    this.patchLineFeature.getGeometry().setCoordinates(coords);
    this.patchPointsLayerSource.clear();
    this.patchPointsLayerSource.addFeatures(
      this.patchPoints.map(item => {
        let feature = new Feature({geometry: item.point});
        feature.setStyle(PATCH_POINTS_STYLE);
        return feature;
      })
    );
  }

  /**
   * Update the total distances of points from a starting index. Assumes that `distance` is correct for all data
   * @param index the index of the last point with a correct `totalDistance`
   */
  private updateTotalDistances(index: number) {
    for(let i = index + 1; i < this.patchPoints.length; ++i) {
      const dataPoint = this.patchPoints[i].data;
      dataPoint.totalDistance = (this.patchPoints[i-1]?.data.totalDistance || 0) + dataPoint.distance;
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
      const mapDataPoint = this.patchPoints[this.previousPointIndex];
      distance = getDistance(toLonLat(mapDataPoint.point.getCoordinates()), toLonLat(coordinate));
      totalDistance = mapDataPoint.data.totalDistance + distance;

      if(this.previousPointIndex < this.patchPoints.length - 1) {
        nextPointDistance = getDistance(toLonLat(coordinate), toLonLat(this.patchPoints[this.previousPointIndex+1].point.getCoordinates()));
        this.patchPoints[this.previousPointIndex+1].data.distance = nextPointDistance;
      }
    }
    this.patchPoints.splice(this.previousPointIndex + 1, 0,
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
      this.setPatchPath(this.patchPoints);
      this.setPreviousPointStyle();
    }
  }

  /**
   * Remove a point at `previousPointIndex`
   * @param render whether to render the path update
   */
  private removePreviousPoint(render = true) {
    if(this.previousPointIndex > 0) {
      this.patchPoints.splice(this.previousPointIndex, 1);
      const mapDataPoint = this.patchPoints[this.previousPointIndex];
      if(this.previousPointIndex < this.patchPoints.length) {
        mapDataPoint.data.distance = getDistance(toLonLat(this.patchPoints[this.previousPointIndex-1].point.getCoordinates()), toLonLat(mapDataPoint.point.getCoordinates()));
      }
      this.previousPointIndex -= 1;
      this.updateTotalDistances(this.previousPointIndex);
    }
    else if(this.previousPointIndex === 0) {
      this.patchPoints.shift();
      if(!this.patchPoints.length) {
        this.previousPointIndex = -1;
      }
      else {
        this.patchPoints[this.previousPointIndex].data.distance = 0;
        this.updateTotalDistances(-1);
      }
    }
    if(render) {
      this.setPatchPath(this.patchPoints);
      this.setPreviousPointStyle();
    }
  }

  /**
   * Move the point at `draggingPointIndex` to a new location
   * @param coordinate 
   * @param render whether to render the path update
   */
  private moveDraggingPoint(coordinate: Coordinate, render = true) {
    const mapDataPoint = this.patchPoints[this.draggingPointIndex];
    mapDataPoint.point.setCoordinates(coordinate);
    if(this.draggingPointIndex !== 0) {
      const previousMapDataPoint = this.patchPoints[this.draggingPointIndex-1]
      mapDataPoint.data.distance = getDistance(toLonLat(previousMapDataPoint.point.getCoordinates()), toLonLat(coordinate));
      mapDataPoint.data.totalDistance = previousMapDataPoint.data.totalDistance + mapDataPoint.data.distance;
    }
    if(this.draggingPointIndex < this.patchPoints.length - 1) {
      const nextMapDataPoint = this.patchPoints[this.draggingPointIndex+1];
      nextMapDataPoint.data.distance = getDistance(toLonLat(mapDataPoint.point.getCoordinates()), toLonLat(nextMapDataPoint.point.getCoordinates()));
    }
    this.updateTotalDistances(this.draggingPointIndex);
    if(render) {
      this.setPatchPath(this.patchPoints);
      this.setPreviousPointStyle();
    }
  }

  private setPreviousPointStyle() {
    this.patchPointsLayerSource.forEachFeature((f: Feature<Geometry>) => {
      if(<Point> f.getGeometry() === this.patchPoints[this.previousPointIndex].point)
        f.setStyle(PATCH_POINTS_PREVIOUS_STYLE);
      else if(f.getStyle() !== PATCH_POINTS_STYLE)
        f.setStyle(PATCH_POINTS_STYLE);
    });
  }


  private initPatcher() {
    this.patchPoints = []
    this.previousPointIndex = -1;
  }

  private cancelPatcher(): boolean {
    this.resetPatcher();
    return true;
  }

}

const app = new RunPatcher();
