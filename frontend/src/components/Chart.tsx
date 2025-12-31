import React from 'react';
import ReactApexChart from 'react-apexcharts';
import type { ApexOptions } from 'apexcharts';

interface ChartProps {
  options: ApexOptions;
  series: ApexOptions['series'];
  type: 'line' | 'bar' | 'area' | 'pie' | 'donut' | 'radialBar' | 'scatter' | 'bubble' | 'heatmap' | 'candlestick' | 'boxPlot' | 'radar' | 'polarArea' | 'rangeBar' | 'rangeArea' | 'treemap';
  height?: string | number;
  width?: string | number;
}

const Chart: React.FC<ChartProps> = ({ options, series, type, height, width }) => {
  return (
    <ReactApexChart
      options={options}
      series={series}
      type={type}
      height={height}
      width={width}
    />
  );
};

export default Chart;
