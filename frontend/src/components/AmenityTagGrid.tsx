import React from "react";
import { Icon } from "@/components/AppIcon";
import { amenityLabel } from "@/lib/amenities";
import { amenityIcon } from "@/lib/amenityIcons";

interface AmenityTagGridProps {
  amenities: string[];
}

export const AmenityTagGrid: React.FC<AmenityTagGridProps> = ({ amenities }) => {
  if (!amenities || amenities.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {amenities.map((a) => {
        return (
          <span
            key={a}
            className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 "
          >
            <Icon name={amenityIcon(a)} className="h-3.5 w-3.5" />
            {amenityLabel(a)}
          </span>
        );
      })}
    </div>
  );
};
