define([
  'lodash',
],
function (_) {
  'use strict';

  function InfluxSeries(options) {
    this.seriesList = options.seriesList;
    this.alias = options.alias;
    this.groupByField = options.groupByField;
    this.annotation = options.annotation;
  }

  var p = InfluxSeries.prototype;

  function compare(x, y) {
    if (x === y) {
      return 0;
    }
    return x > y ? 1 : -1;
  }

  function histogramSort(firstCol, secondCol, x, y) {
    var result = compare(x[firstCol], y[firstCol]);
    if (result !== 0) {
      return result;
    }
    return compare(x[secondCol], y[secondCol]);
  }

  p.getTimeSeries = function() {
    var output = [];
    var self = this;
    var i;

    _.each(self.seriesList, function(series) {
      var seriesName;
      var timeCol = series.columns.indexOf('time');
      var valueCol = 1;
      var valueColBucketStart = -1;
      var valueColCount = -1;
      var groupByCol = -1;

      if (self.groupByField) {
        groupByCol = series.columns.indexOf(self.groupByField);
      }

      // find value column
      _.each(series.columns, function(column, index) {
        if (column !== 'time' && column !== 'sequence_number' && column !== self.groupByField) {
          valueCol = index;
          if (column.indexOf('bucket_start') > -1) {
            valueColBucketStart = index;
          } else if (column.indexOf('count') > -1) {
            valueColCount = index;
          }
        }
      });

      var isHistogram = valueColBucketStart >= 0 && valueColCount >= 0;
      var groups = {};

      if (self.groupByField) {
        groups = _.groupBy(series.points, function (point) {
          return point[groupByCol];
        });
      }
      else {
        if (isHistogram) {
          series.points.sort(histogramSort.bind(this, timeCol, valueColBucketStart));
          groups['histogram'] = series.points;
        } else {
          groups[series.columns[valueCol]] = series.points;
        }
      }

      _.each(groups, function(groupPoints, key) {
        var datapoints = [];
        for (i = 0; i < groupPoints.length; i++) {
          if (isHistogram) {
            var metricBucketStart = isNaN(groupPoints[i][valueColBucketStart]) ? null : groupPoints[i][valueColBucketStart];
            var metricCount = isNaN(groupPoints[i][valueColCount]) ? null : groupPoints[i][valueColCount];
            datapoints[i] = [metricBucketStart, metricCount, groupPoints[i][timeCol]];
          } else {
            var metricValue = isNaN(groupPoints[i][valueCol]) ? null : groupPoints[i][valueCol];
            datapoints[i] = [metricValue, groupPoints[i][timeCol]];
          }
        }

        seriesName = series.name + '.' + key;

        if (self.alias) {
          seriesName = self.createNameForSeries(series.name, key);
        }

        output.push({ target: seriesName, datapoints: datapoints, isHistogram: isHistogram });
      });
    });

    return output;
  };

  p.getAnnotations = function () {
    var list = [];
    var self = this;

    _.each(this.seriesList, function (series) {
      var titleCol = null;
      var timeCol = null;
      var tagsCol = null;
      var textCol = null;

      _.each(series.columns, function(column, index) {
        if (column === 'time') { timeCol = index; return; }
        if (column === 'sequence_number') { return; }
        if (!titleCol) { titleCol = index; }
        if (column === self.annotation.titleColumn) { titleCol = index; return; }
        if (column === self.annotation.tagsColumn) { tagsCol = index; return; }
        if (column === self.annotation.textColumn) { textCol = index; return; }
      });

      _.each(series.points, function (point) {
        var data = {
          annotation: self.annotation,
          time: point[timeCol] * 1000,
          title: point[titleCol],
          tags: point[tagsCol],
          text: point[textCol]
        };

        if (tagsCol) {
          data.tags = point[tagsCol];
        }

        list.push(data);
      });
    });

    return list;
  };

  p.createNameForSeries = function(seriesName, groupByColValue) {
    var name = this.alias
      .replace('$s', seriesName);

    var segments = seriesName.split('.');
    for (var i = 0; i < segments.length; i++) {
      if (segments[i].length > 0) {
        name = name.replace('$' + i, segments[i]);
      }
    }

    if (this.groupByField) {
      name = name.replace('$g', groupByColValue);
    }

    return name;
  };

  return InfluxSeries;
});
