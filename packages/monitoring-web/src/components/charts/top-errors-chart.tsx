'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';

interface TopErrorData {
  name: string;
  count: number;
  level: string;
}

interface TopErrorsChartProps {
  data: TopErrorData[];
  loading?: boolean;
  onBarClick?: (name: string) => void;
}

const getLevelColor = (level: string) => {
  switch (level) {
    case 'FATAL':
      return '#dc2626';
    case 'ERROR':
      return '#f97316';
    case 'WARNING':
      return '#eab308';
    case 'INFO':
      return '#3b82f6';
    default:
      return '#6b7280';
  }
};

export function TopErrorsChart({ data, loading, onBarClick }: TopErrorsChartProps) {
  if (loading) {
    return (
      <div className="h-[300px] w-full animate-pulse bg-muted/30 rounded-lg" />
    );
  }

  if (data.length === 0) {
    return (
      <div className="h-[300px] w-full flex items-center justify-center text-muted-foreground">
        No errors to display
      </div>
    );
  }

  const truncateName = (name: string, maxLength: number = 30) => {
    if (name.length <= maxLength) return name;
    return name.substring(0, maxLength) + '...';
  };

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
      >
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="rgba(255,255,255,0.1)"
          horizontal={true}
          vertical={false}
        />
        <XAxis
          type="number"
          stroke="rgba(255,255,255,0.4)"
          fontSize={12}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          type="category"
          dataKey="name"
          stroke="rgba(255,255,255,0.4)"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          width={150}
          tickFormatter={(value) => truncateName(value, 25)}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: 'hsl(var(--card))',
            border: '1px solid hsl(var(--border))',
            borderRadius: '8px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
          }}
          labelStyle={{ color: 'hsl(var(--foreground))' }}
          formatter={(value: number) => [value.toLocaleString(), 'Events']}
          cursor={{ fill: 'rgba(255,255,255,0.05)' }}
        />
        <Bar
          dataKey="count"
          radius={[0, 4, 4, 0]}
          onClick={(data) => onBarClick?.(data.name)}
          style={{ cursor: onBarClick ? 'pointer' : 'default' }}
        >
          {data.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={getLevelColor(entry.level)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
