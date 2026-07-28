# MyStash - World-Class Vertical Reels Feed

## 🎯 Overview

This implementation creates a high-performance vertical reels feed similar to TikTok/Instagram Reels with the following key features:

### ✨ Core Features Implemented

1. **Embed Facade Pattern**: Static thumbnails initially, WebView only for active videos
2. **Vertical Swipe Physics**: Smooth, native-feeling vertical scrolling
3. **Viewability Tracking**: Intelligent active video detection (90% threshold)
4. **Stash Overlay**: Product information with buy button overlay
5. **Supabase Integration**: Backend data fetching with fallback to mock data
6. **Platform Support**: YouTube and Instagram embed URLs

## 🏗️ Architecture

### Components

- **ReelItem.tsx**: Main reel component with embed facade pattern
- **Home Screen**: Vertical FlatList with swipe physics
- **Embed Utils**: URL conversion utilities for social platforms
- **Supabase Service**: Backend integration layer

### Performance Optimizations

- **Lazy Loading**: WebView only loads for active video
- **Image Caching**: High-priority thumbnail caching
- **FlatList Optimization**: `removeClippedSubviews`, `maxToRenderPerBatch`
- **Smooth Transitions**: Fade animations between thumbnail and video

## 🚀 Setup Instructions

### 1. Environment Configuration

```bash
# Copy the example environment file
cp .env.example .env

# Add your Supabase credentials
EXPO_PUBLIC_SUPABASE_URL=your_supabase_project_url
EXPO_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

### 2. Supabase Database Setup

Create a `videos` table in your Supabase project:

```sql
CREATE TABLE videos (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  thumbnail TEXT NOT NULL,
  creator_name TEXT NOT NULL,
  stash_score DECIMAL(3,1) NOT NULL,
  product_name TEXT NOT NULL,
  embed_url TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### 3. Running the App

```bash
# Start the development server
npm start

# Run on specific platforms
npm run ios
npm run android
npm run web
```

## 🎬 Video URL Support

### YouTube URLs
- `https://www.youtube.com/watch?v=VIDEO_ID`
- `https://youtu.be/VIDEO_ID`

### Instagram URLs  
- `https://www.instagram.com/p/POST_ID/`

The system automatically converts these to embed URLs:
- YouTube: `https://www.youtube.com/embed/VIDEO_ID`
- Instagram: `https://www.instagram.com/p/POST_ID/embed`

## 🎨 UI Components

### Stash Overlay
- **Product Name**: Bold white text with shadow
- **Creator Name**: Secondary information
- **Stash Score**: Star rating display
- **Buy Button**: Red "Stash It" CTA button

### Swipe Physics
- `pagingEnabled={true}`: Snap to full screen
- `snapToInterval={SCREEN_HEIGHT}`: Perfect alignment
- `decelerationRate="fast"`: Quick, responsive scrolling
- `viewabilityConfig`: 90% visibility threshold

## 🔧 Technical Details

### Embed Facade Pattern
```typescript
// Only load WebView for active video
useEffect(() => {
  if (isActive && video.embed_url) {
    // Fade out thumbnail
    // Load WebView
    // Fade in video
  }
}, [isActive, video.embed_url]);
```

### Viewability Tracking
```typescript
const viewabilityConfig = {
  itemVisiblePercentThreshold: 90,
  minimumViewTime: 300,
};
```

### Performance Settings
```typescript
<FlatList
  removeClippedSubviews={true}
  maxToRenderPerBatch={3}
  windowSize={5}
  initialNumToRender={1}
/>
```

## 📱 Usage

1. **Vertical Swipe**: Scroll between reels
2. **Auto-Play**: Videos automatically play when visible
3. **Stash Items**: Tap "Stash It" to save products
4. **Search**: Use Search tab to find specific content

## 🔄 Data Flow

```
Supabase (if available) → Fallback to Mock Data → ReelItem Component
     ↓
Viewability Tracking → Active Video Detection → WebView Loading
     ↓
User Interaction → Stash Overlay → Buy Button Actions
```

## 🚨 Important Notes

- **WebView Performance**: Only loads for active video to prevent lag
- **Thumbnail Caching**: Uses expo-image with high priority caching
- **Platform Limitations**: Instagram embeds may have restrictions
- **Fallback Strategy**: App works without Supabase using mock data

## 🎯 Next Steps

1. **Authentication**: Add user login with Supabase Auth
2. **Video Upload**: Implement video submission workflow
3. **Analytics**: Track user engagement and stash actions
4. **Social Features**: Add likes, comments, and sharing
5. **Monetization**: Implement affiliate links and purchase tracking

This implementation provides a solid foundation for a world-class reels feed with excellent performance and user experience.
