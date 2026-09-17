import { useEffect, useState } from "react";
import { useParams, useLocation } from "react-router-dom";
import { ProductDetailsPage } from "./ProductDetailsPage";
import { getGarments, Garment, isWomensGarment } from "../services/api";

import fallbackImg from "figma:asset/a7bd8f94aa8209f92fa4986a16a8b5cbecee02b3.png";

export function GarmentDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const stateItem = location.state?.item as { id?: string; name?: string; image?: string; color?: string; category?: string } | undefined;

  const [garment, setGarment] = useState<Garment | null>(stateItem ? {
    id: String(stateItem.id || id),
    name: stateItem.name || "Custom Garment",
    imageUrl: stateItem.image || fallbackImg,
    color: stateItem.color || "Custom",
    category: stateItem.category || "saree"
  } : null);

  const [loading, setLoading] = useState(!stateItem);

  useEffect(() => {
    if (!stateItem && id) {
      getGarments().then((list) => {
        const found = list.find((g) => String(g.id) === String(id));
        if (found) {
          setGarment(found);
        } else if (list.length > 0) {
          setGarment(list[0]);
        }
        setLoading(false);
      });
    }
  }, [id, stateItem]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f6f6f6] flex items-center justify-center font-['Clash_Display',sans-serif]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-black border-t-transparent rounded-full animate-spin" />
          <p className="text-xl font-medium text-gray-700">Loading Garment Details...</p>
        </div>
      </div>
    );
  }

  const garmentName = garment?.name || "Designer Fashion Garment";
  const garmentImage = garment?.imageUrl || fallbackImg;
  const garmentCategory = garment?.category ? garment.category.toUpperCase() : "Catalog Collection";
  const garmentColor = garment?.color || "Custom Palette";

  // Send the breadcrumb to the collection this garment actually belongs to,
  // instead of dropping every product back on the home page.
  const categoryLink = isWomensGarment(garment?.category, garment?.name) ? "/womens" : "/mens";

  return (
    <ProductDetailsPage
      category={`${garmentCategory} Collection`}
      categoryLink={categoryLink}
      productName={garmentName}
      brand={`Lavix • ${garmentColor}`}
      price={3999}
      originalPrice={4999}
      discountPercentage={20}
      discountAmount={1000}
      images={[garmentImage, garmentImage, garmentImage]}
      colors={[
        { name: garmentColor, hex: "#c29b7f", image: garmentImage },
        { name: "Royal Navy", hex: "#1d2a44" },
        { name: "Crimson Red", hex: "#800e13" },
        { name: "Emerald", hex: "#1b4332" },
        { name: "Midnight Black", hex: "#111111" }
      ]}
      sizes={[28, 30, 32, 34, 36]}
      relatedProducts={[
        { id: 1, name: garmentName, image: garmentImage },
      ]}
      model3dUrl={garment?.model3dUrl}
      frontCutoutUrl={garment?.frontCutoutUrl}
      backCutoutUrl={garment?.backCutoutUrl}
    />
  );
}
