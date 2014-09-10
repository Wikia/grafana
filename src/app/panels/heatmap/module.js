define([
  'angular',
  'app',
  'jquery',
  'lodash',
  'kbn',
  'moment',
  'components/timeSeries',
  './seriesOverridesCtrl',
  'services/panelSrv',
  'services/annotationsSrv',
  'services/datasourceSrv',
  'jquery.flot',
  'jquery.flot.events',
  'jquery.flot.selection',
  'jquery.flot.time',
  'jquery.flot.stack',
  'jquery.flot.stackpercent'
],
function (angular, app, $, _, kbn, moment, TimeSeries) {
  'use strict';

  var module = angular.module('grafana.panels.heatmap');
  app.useModule(module);

  module.controller('HeatmapCtrl', function($scope, $rootScope, $timeout, panelSrv, annotationsSrv) {

    $scope.panelMeta = {
      modals : [],
      editorTabs: [],
      fullEditorTabs : [
        {
          title: 'General',
          src:'app/partials/panelgeneral.html'
        },
        {
          title: 'Metrics',
          src:'app/partials/metrics.html'
        },
        {
          title:'Axes & Grid',
          src:'app/panels/heatmap/axisEditor.html'
        }
      ],
      fullscreenEdit: true,
      fullscreenView: true,
      description : "Graphing"
    };

    // Set and populate defaults
    var _d = {

      datasource: null,

      /** @scratch /panels/histogram/3
       * renderer:: sets client side (flot) or native graphite png renderer (png)
       */
      renderer: 'flot',
      /** @scratch /panels/histogram/3
       * x-axis:: Show the x-axis
       */
      'x-axis'      : true,
      /** @scratch /panels/histogram/3
       * y-axis:: Show the y-axis
       */
      'y-axis'      : true,
      /** @scratch /panels/histogram/3
       * scale:: Scale the y-axis by this factor
       */
      scale         : 1,
      /** @scratch /panels/histogram/3
       * y_formats :: 'none','bytes','bits','bps','short', 's', 'ms'
       */
      y_formats    : ['short', 'short'],
      /** @scratch /panels/histogram/5
       * grid object:: Min and max y-axis values
       * grid.min::: Minimum y-axis value
       * grid.ma1::: Maximum y-axis value
       */
      grid          : {
        leftMax: null,
        leftMin: null,
        depthMin: null,
        depthMax: null,
        bucketCount: 30,
        mapColor: 'rgba(216, 200, 27, 1)',
      },

      annotate      : {
        enable      : false,
      },

      legend: {
        show: false, // disable/enable legend
        values: false, // disable/enable legend values
        min: false,
        max: false,
        current: false,
        total: false,
        avg: false
      },

      tooltip       : {
      },

      targets: [{}],

      aliasColors: {},

      seriesOverrides: [],
    };

    _.defaults($scope.panel,_d);
    _.defaults($scope.panel.tooltip, _d.tooltip);
    _.defaults($scope.panel.annotate, _d.annotate);
    _.defaults($scope.panel.grid, _d.grid);

    $scope.hiddenSeries = {};

    $scope.updateTimeRange = function () {
      $scope.range = $scope.filter.timeRange();
      $scope.rangeUnparsed = $scope.filter.timeRange(false);
      $scope.resolution = Math.ceil($(window).width() * ($scope.panel.span / 12));
      $scope.interval = '10m';

      if ($scope.range) {
        $scope.interval = kbn.secondsToHms(
          kbn.calculate_interval($scope.range.from, $scope.range.to, $scope.resolution, 0) / 1000
        );
      }
    };

    $scope.get_data = function() {
      $scope.updateTimeRange();

      var metricsQuery = {
        range: $scope.rangeUnparsed,
        interval: $scope.interval,
        targets: $scope.panel.targets,
        format: $scope.panel.renderer === 'png' ? 'png' : 'json',
        maxDataPoints: $scope.resolution,
        cacheTimeout: $scope.panel.cacheTimeout
      };

      $scope.annotationsPromise = annotationsSrv.getAnnotations($scope.filter, $scope.rangeUnparsed, $scope.dashboard);

      return $scope.datasource.query($scope.filter, metricsQuery)
        .then($scope.dataHandler)
        .then(null, function(err) {
          $scope.panelMeta.loading = false;
          $scope.panel.error = err.message || "Timeseries data request error";
          $scope.inspector.error = err;
          $scope.render([]);
        });
    };

    $scope.dataHandler = function(results) {
      $scope.panelMeta.loading = false;
      $scope.legend = [];

      // png renderer returns just a url
      if (_.isString(results)) {
        $scope.render(results);
        return;
      }

      $scope.datapointsWarning = false;
      $scope.datapointsCount = 0;
      $scope.datapointsOutside = false;

      var data = _.map(results.data, $scope.seriesHandler);

      //$scope.datapointsWarning = $scope.datapointsCount === 0 || $scope.datapointsOutside;

      $scope.annotationsPromise
        .then(function(annotations) {
          data.annotations = annotations;
          $scope.render(data);
        }, function() {
          $scope.render(data);
        });
    };

    /*jshint unused: vars */
    $scope.seriesHandler = function(seriesData, index) {
      var datapoints = seriesData.datapoints;
      var alias = seriesData.target;
      var color = $scope.panel.grid.mapColor;

      var seriesInfo = {
        alias: alias,
        color:  color,
        isHistogram: seriesData.isHistogram,
      };

      if (seriesInfo.isHistogram && $scope.legend.length === 0) {
        $scope.legend.push(seriesInfo);
      }

      var series = new TimeSeries({
        datapoints: datapoints,
        info: seriesInfo,
      });

      if (datapoints && datapoints.length > 0) {
        var last = moment.utc(datapoints[datapoints.length - 1][1] * 1000);
        var from = moment.utc($scope.range.from);
        if (last - from < -10000) {
          $scope.datapointsOutside = true;
        }

        $scope.datapointsCount += datapoints.length;
      }

      return series;
    };

    $scope.render = function(data) {
      $scope.$emit('render', data);
    };

    $scope.changeSeriesColor = function(series, color) {
      series.color = color;
      $scope.panel.aliasColors[series.alias] = series.color;
      $scope.render();
    };

    $scope.toggleSeries = function(serie, event) {
      if ($scope.hiddenSeries[serie.alias]) {
        delete $scope.hiddenSeries[serie.alias];
      }
      else {
        $scope.hiddenSeries[serie.alias] = true;
      }

      if (event.ctrlKey || event.metaKey || event.shiftKey) {
        $scope.toggleSeriesExclusiveMode(serie);
      }

      $scope.$emit('toggleLegend', $scope.legend);
    };

    $scope.toggleSeriesExclusiveMode = function(serie) {
      var hidden = $scope.hiddenSeries;

      if (hidden[serie.alias]) {
        delete hidden[serie.alias];
      }

      // check if every other series is hidden
      var alreadyExclusive = _.every($scope.legend, function(value) {
        if (value.alias === serie.alias) {
          return true;
        }

        return hidden[value.alias];
      });

      if (alreadyExclusive) {
        // remove all hidden series
        _.each($scope.legend, function(value) {
          delete $scope.hiddenSeries[value.alias];
        });
      }
      else {
        // hide all but this serie
        _.each($scope.legend, function(value) {
          if (value.alias === serie.alias) {
            return;
          }

          $scope.hiddenSeries[value.alias] = true;
        });
      }
    };

    $scope.toggleYAxis = function(info) {
      var override = _.findWhere($scope.panel.seriesOverrides, { alias: info.alias });
      if (!override) {
        override = { alias: info.alias };
        $scope.panel.seriesOverrides.push(override);
      }
      override.yaxis = info.yaxis === 2 ? 1 : 2;
      $scope.render();
    };

    $scope.toggleGridMinMax = function(key) {
      $scope.panel.grid[key] = _.toggle($scope.panel.grid[key], null, 0);
      $scope.render();
    };

    $scope.addSeriesOverride = function() {
      $scope.panel.seriesOverrides.push({});
    };

    $scope.removeSeriesOverride = function(override) {
      $scope.panel.seriesOverrides = _.without($scope.panel.seriesOverrides, override);
      $scope.render();
    };

    panelSrv.init($scope);
  });

});