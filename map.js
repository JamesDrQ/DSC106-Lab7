
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7/+esm';

// Set Mapbox access token
mapboxgl.accessToken = 'pk.eyJ1IjoiamFtZXNxaWFuIiwiYSI6ImNtd2VqaGRmcTBhOHcyeG9xejU4eGh3cTIifQ.FUyGpNyXKj84nQe5_qdKgQ';

// Initialize the map
const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/streets-v12',
  center: [-71.09415, 42.36027],
  zoom: 12,
  minZoom: 5,
  maxZoom: 18,
});

const svg = d3.select('#map').select('svg');

// Convert geographic coordinates to screen coordinates
function getCoords(station) {
  const point = new mapboxgl.LngLat(
    +station.lon,
    +station.lat
  );

  const { x, y } = map.project(point);
  return { cx: x, cy: y };
}

// Format minutes as a readable time
function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);

  return date.toLocaleString('en-US', {
    timeStyle: 'short',
  });
}

// Calculate minutes since midnight
function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

// Filter trips by selected time (+/- 60 minutes)
function filterTripsByTime(trips, timeFilter) {
  if (timeFilter === -1) {
    return trips;
  }

  return trips.filter(trip => {
    const startedMinutes = minutesSinceMidnight(trip.started_at);
    const endedMinutes = minutesSinceMidnight(trip.ended_at);

    // Handle the time window across midnight
    const startDiff = Math.abs(startedMinutes - timeFilter);
    const endDiff = Math.abs(endedMinutes - timeFilter);

    const startDistance = Math.min(startDiff, 1440 - startDiff);
    const endDistance = Math.min(endDiff, 1440 - endDiff);

    return startDistance <= 60 || endDistance <= 60;
  });
}

// Calculate arrivals, departures, and total traffic
function computeStationTraffic(stations, trips) {
  const departures = d3.rollup(
    trips,
    v => v.length,
    d => d.start_station_id
  );

  const arrivals = d3.rollup(
    trips,
    v => v.length,
    d => d.end_station_id
  );

  return stations.map(station => {
    const id = station.short_name;

    station.departures = departures.get(id) ?? 0;
    station.arrivals = arrivals.get(id) ?? 0;
    station.totalTraffic =
      station.departures + station.arrivals;

    return station;
  });
}

// Initialize layers and data when the map loads
map.on('load', async () => {
  // Shared bike lane styling
  const bikeLaneStyle = {
    'line-color': '#32D400',
    'line-width': 5,
    'line-opacity': 0.6,
  };

  // Boston bike lanes
  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
  });

  map.addLayer({
    id: 'bike-lanes',
    type: 'line',
    source: 'boston_route',
    paint: bikeLaneStyle,
  });

  // Cambridge bike lanes
  map.addSource('cambridge_route', {
    type: 'geojson',
    data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson',
  });

  map.addLayer({
    id: 'cambridge-bike-lanes',
    type: 'line',
    source: 'cambridge_route',
    paint: bikeLaneStyle,
  });

  try {
    // Load Bluebikes station data
    const jsonurl =
      'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';

    const jsonData = await d3.json(jsonurl);

    // Load and parse trip data
    const trips = await d3.csv(
      'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv',
      trip => {
        trip.started_at = new Date(trip.started_at);
        trip.ended_at = new Date(trip.ended_at);
        return trip;
      }
    );

    // Compute initial traffic for all stations
    const stations = computeStationTraffic(
      jsonData.data.stations,
      trips
    );

    console.log('Total Stations:', stations.length);
    console.log('Total Trips:', trips.length);
    console.log('Max Traffic:',
      d3.max(stations, d => d.totalTraffic));

    // Create radius scale
    const radiusScale = d3
      .scaleSqrt()
      .domain([0, d3.max(stations, d => d.totalTraffic) || 1])
      .range([0, 25]);
    
    const stationFlow = d3.scaleQuantize()
    .domain([0, 1])
    .range([0, 0.5, 1]);

    function getDepartureRatio(d) {
    if (d.totalTraffic === 0) return 0.5;

    return stationFlow(d.departures / d.totalTraffic);
    }

    // Draw station markers
    const circles = svg
      .selectAll('circle')
      .data(stations)
      .enter()
      .append('circle')
      .attr('r', d => radiusScale(d.totalTraffic))
      .attr('stroke', 'white')
      .attr('stroke-width', 1)
      .attr('opacity', 1)
      .style('--departure-ratio', d => getDepartureRatio(d))
      .each(function(d) {
        d3.select(this)
          .append('title')
          .text(
            `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`
          );
      });

    // Update marker positions when the map moves
    function updatePositions() {
      circles
        .attr('cx', d => getCoords(d).cx)
        .attr('cy', d => getCoords(d).cy);
    }

    updatePositions();

    map.on('move', updatePositions);
    map.on('zoom', updatePositions);
    map.on('resize', updatePositions);
    map.on('moveend', updatePositions);

    // Set up time slider
    const timeSlider = document.getElementById('time-slider');
    const selectedTime = document.getElementById('selected-time');
    const anyTimeLabel = document.getElementById('any-time');

    let timeFilter = -1;

    // Update station traffic based on selected time
    function updateScatterPlot(timeFilter) {
      // Filter trips within the time window
      const filteredTrips = filterTripsByTime(
        trips,
        timeFilter
      );

      // Recalculate traffic
      computeStationTraffic(stations, filteredTrips);

      // Update radius scale
      radiusScale.range(
        timeFilter === -1 ? [0, 25] : [3, 50]
      );

      // Update circle sizes
      
      circles
        .attr('r', d => radiusScale(d.totalTraffic))
        .style('--departure-ratio', d => getDepartureRatio(d));


      // Update tooltips
      circles.select('title')
        .text(
          d => `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`
        );

      console.log(
        'Selected Time:', timeFilter,
        'Filtered Trips:', filteredTrips.length
      );
    }

    // Update time display and visualization
    function updateTimeDisplay() {
      timeFilter = Number(timeSlider.value);

      if (timeFilter === -1) {
        selectedTime.textContent = '';
        anyTimeLabel.style.display = 'block';
      } else {
        selectedTime.textContent = formatTime(timeFilter);
        anyTimeLabel.style.display = 'none';
      }

      updateScatterPlot(timeFilter);
    }

    // Listen for slider changes
    timeSlider.addEventListener('input', updateTimeDisplay);

    // Initialize display
    updateTimeDisplay();

  } catch (error) {
    console.error('Error loading data:', error);
  }
});
