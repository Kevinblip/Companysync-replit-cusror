import { Card, CardContent } from "@/components/ui/card";

const colorClasses = {
  blue: {
    bg: { light: "bg-blue-50", dark: "bg-blue-900/20" },
    icon: { light: "text-blue-600", dark: "text-blue-400" },
    border: { light: "border-blue-200", dark: "border-blue-800" },
    text: { light: "text-blue-600", dark: "text-blue-400" }
  },
  green: {
    bg: { light: "bg-green-50", dark: "bg-green-900/20" },
    icon: { light: "text-green-600", dark: "text-green-400" },
    border: { light: "border-green-200", dark: "border-green-800" },
    text: { light: "text-green-600", dark: "text-green-400" }
  },
  orange: {
    bg: { light: "bg-orange-50", dark: "bg-orange-900/20" },
    icon: { light: "text-orange-600", dark: "text-orange-400" },
    border: { light: "border-orange-200", dark: "border-orange-800" },
    text: { light: "text-orange-600", dark: "text-orange-400" }
  },
  purple: {
    bg: { light: "bg-purple-50", dark: "bg-purple-900/20" },
    icon: { light: "text-purple-600", dark: "text-purple-400" },
    border: { light: "border-purple-200", dark: "border-purple-800" },
    text: { light: "text-purple-600", dark: "text-purple-400" }
  },
};

export default function SmallMetricCard({ title, value, total, icon: Icon, color, darkMode }) {
  const mode = darkMode ? 'dark' : 'light';
  const selected = colorClasses[color] || colorClasses.blue;

  return (
    <Card className={`border ${selected.border[mode]} hover:shadow-md transition-shadow ${darkMode ? 'bg-slate-800' : 'bg-white'}`}>
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-lg ${darkMode ? 'bg-slate-700' : 'bg-gray-100'} flex items-center justify-center flex-shrink-0`}>
            {Icon && <Icon className={`w-5 h-5 ${selected.icon[mode]}`} />}
          </div>
          <div>
            <p className={`text-xs ${darkMode ? 'text-slate-400' : 'text-gray-600'}`}>{title}</p>
            <p className={`text-xl font-bold ${selected.text[mode]}`}>{value} / {total}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
