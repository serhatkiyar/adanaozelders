import React from "react";
import { amenityTiClass, amenityLabel } from "@/lib/amenities";

interface AmenityTagGridProps {
  amenities: string[];
}

export const AmenityTagGrid: React.FC<AmenityTagGridProps> = ({ amenities }) => {
  if (!amenities || amenities.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {amenities.map((a) => (
        <span
          key={a}
          className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300"
        >
          <i className={amenityTiClass(a)} aria-hidden="true"></i>
          {amenityLabel(a)}
        </span>
      ))}
    </div>
  );
};
