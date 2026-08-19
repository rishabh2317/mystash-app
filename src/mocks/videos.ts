export interface Product {
  id: string;
  name: string;
  price: string;
  image: string;
  provider?: string;
  catalog_product_id?: string;
}

export interface Video {
  id: string;
  url: string;
  thumbnail: string;
  creator_name: string;
  stash_score: number;
  product_name: string;
  embed_url?: string;
  video_title?: string;
  curator_id?: string;
  collection_id?: string | null;
  products?: Product[];
}

export const mockVideos: Video[] = [
  {
    id: "1",
    url: "https://youtube.com/shorts/5V3aQmnfWUI?si=KXvlGIYDBqK694jV",
    thumbnail: "https://img.youtube.com/vi/5V3aQmnfWUI/maxresdefault.jpg",
    creator_name: "TechGuru",
    stash_score: 4.8,
    product_name: "Wireless Headphones",
    embed_url: "https://www.youtube.com/embed/5V3aQmnfWUI",
    video_title: "Ultimate Tech Review 2024",
    curator_id: "@techguru_official",
    products: [
      { id: "1", name: "Premium Item", price: "$99", image: "https://picsum.photos/seed/tech1/100/100.jpg" },
      { id: "2", name: "Premium Item", price: "$149", image: "https://picsum.photos/seed/tech2/100/100.jpg" },
      { id: "3", name: "Premium Item", price: "$79", image: "https://picsum.photos/seed/tech3/100/100.jpg" },
      { id: "4", name: "Premium Item", price: "$199", image: "https://picsum.photos/seed/tech4/100/100.jpg" },
      { id: "5", name: "Premium Item", price: "$129", image: "https://picsum.photos/seed/tech5/100/100.jpg" }
    ]
  },
  {
    id: "2", 
    url: "https://youtube.com/shorts/EnRWxni3KaQ?si=LU-ALeKI2m90onNQ",
    thumbnail: "https://img.youtube.com/vi/EnRWxni3KaQ/maxresdefault.jpg",
    creator_name: "StyleExpert",
    stash_score: 4.5,
    product_name: "Designer Watch",
    embed_url: "https://www.youtube.com/embed/EnRWxni3KaQ",
    video_title: "Fashion Trends 2024",
    curator_id: "@styleexpert",
    products: [
      { id: "1", name: "Premium Item", price: "$89", image: "https://picsum.photos/seed/fashion1/100/100.jpg" },
      { id: "2", name: "Premium Item", price: "$159", image: "https://picsum.photos/seed/fashion2/100/100.jpg" },
      { id: "3", name: "Premium Item", price: "$119", image: "https://picsum.photos/seed/fashion3/100/100.jpg" },
      { id: "4", name: "Premium Item", price: "$209", image: "https://picsum.photos/seed/fashion4/100/100.jpg" },
      { id: "5", name: "Premium Item", price: "$139", image: "https://picsum.photos/seed/fashion5/100/100.jpg" }
    ]
  },
  {
    id: "3",
    url: "https://www.instagram.com/p/CU6P3PvJ5Q8/",
    thumbnail: "https://picsum.photos/seed/fitness/640/1136.jpg",
    creator_name: "FitnessPro",
    stash_score: 4.9,
    product_name: "Yoga Mat Pro",
    embed_url: "https://www.instagram.com/reel/DVe36ThDGWk",
    video_title: "Fitness Journey 2024",
    curator_id: "@fitnesspro",
    products: [
      { id: "1", name: "Premium Item", price: "$69", image: "https://picsum.photos/seed/fitness1/100/100.jpg" },
      { id: "2", name: "Premium Item", price: "$129", image: "https://picsum.photos/seed/fitness2/100/100.jpg" },
      { id: "3", name: "Premium Item", price: "$99", image: "https://picsum.photos/seed/fitness3/100/100.jpg" },
      { id: "4", name: "Premium Item", price: "$179", image: "https://picsum.photos/seed/fitness4/100/100.jpg" },
      { id: "5", name: "Premium Item", price: "$149", image: "https://picsum.photos/seed/fitness5/100/100.jpg" }
    ]
  },
  {
    id: "4",
    url: "https://youtube.com/shorts/GbcFXTyoX7s?si=dbYIPV4XKvQWvxg4",
    thumbnail: "https://img.youtube.com/vi/GbcFXTyoX7s/maxresdefault.jpg",
    creator_name: "FoodieLife",
    stash_score: 4.6,
    product_name: "Air Fryer Deluxe",
    embed_url: "https://www.youtube.com/embed/GbcFXTyoX7s",
    video_title: "Cooking Masterclass",
    curator_id: "@foodielife",
    products: [
      { id: "1", name: "Premium Item", price: "$79", image: "https://picsum.photos/seed/food1/100/100.jpg" },
      { id: "2", name: "Premium Item", price: "$139", image: "https://picsum.photos/seed/food2/100/100.jpg" },
      { id: "3", name: "Premium Item", price: "$109", image: "https://picsum.photos/seed/food3/100/100.jpg" },
      { id: "4", name: "Premium Item", price: "$189", image: "https://picsum.photos/seed/food4/100/100.jpg" },
      { id: "5", name: "Premium Item", price: "$159", image: "https://picsum.photos/seed/food5/100/100.jpg" }
    ]
  },
  {
    id: "5",
    url: "https://www.instagram.com/p/CX8m9oL2Y7R/",
    thumbnail: "https://picsum.photos/seed/gaming/640/1136.jpg",
    creator_name: "GamerZone",
    stash_score: 4.7,
    product_name: "Gaming Chair RGB",
    embed_url: "https://www.instagram.com/p/CX8m9oL2Y7R/embed",
    video_title: "Gaming Setup 2024",
    curator_id: "@gamerzone",
    products: [
      { id: "1", name: "Premium Item", price: "$199", image: "https://picsum.photos/seed/gaming1/100/100.jpg" },
      { id: "2", name: "Premium Item", price: "$299", image: "https://picsum.photos/seed/gaming2/100/100.jpg" },
      { id: "3", name: "Premium Item", price: "$249", image: "https://picsum.photos/seed/gaming3/100/100.jpg" },
      { id: "4", name: "Premium Item", price: "$349", image: "https://picsum.photos/seed/gaming4/100/100.jpg" },
      { id: "5", name: "Premium Item", price: "$279", image: "https://picsum.photos/seed/gaming5/100/100.jpg" }
    ]
  }
];
