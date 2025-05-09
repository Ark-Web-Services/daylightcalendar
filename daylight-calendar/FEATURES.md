# Daylight Calendar Feature Status

This document tracks the implementation status of all requested features for the Daylight Calendar application.

## Settings

| Feature | Status | Notes |
|---------|--------|-------|
| Settings button in lower left | ✅ Implemented | Moved from tab list to bottom left of sidebar |
| Microphone/camera testing | ✅ Implemented | Added to settings tab |
| User management | ⚠️ Partial | Basic user profiles exist but need improved management UI |
| Home Assistant integration | ❌ Not Started | Need to implement sync with HA accounts |
| Profile picture from webcam | ❌ Not Started | Planned feature |

## Cooking Mode

| Feature | Status | Notes |
|---------|--------|-------|
| Recipe cooking mode | ✅ Implemented | Step-by-step interface with instructions |
| Voice control | ✅ Implemented | Basic voice commands for navigating steps |
| Cook time estimation | ⚠️ Partial | Basic cook time exists but not start time calculation |
| Timer functionality | ✅ Implemented | Timer available during cooking mode |

## Meal Planning

| Feature | Status | Notes |
|---------|--------|-------|
| Default meal categories | ✅ Implemented | Breakfast, lunch, dinner included |
| Add custom categories | ✅ Implemented | UI allows adding new categories |
| Recipe book | ✅ Implemented | Recipe browsing and details |
| Recipe ingredient tracking | ✅ Implemented | Tracks available ingredients |
| Add to grocery list | ✅ Implemented | Can add missing ingredients to grocery list |
| Purchase history | ✅ Implemented | Shows when ingredients were last purchased |
| Community recipes | ⚠️ Partial | "Get More Recipes" button exists but needs backend integration |

## Games

| Feature | Status | Notes |
|---------|--------|-------|
| Profile selection | ✅ Implemented | Can select user profile before playing games |
| Playtime limits based on rewards | ✅ Implemented | Games have time limits based on accumulated points |
| Timer display | ✅ Implemented | Shows remaining playtime |
| Age-appropriate filtering | ⚠️ Partial | Age rating exists but filtering needs improvement |
| Add games button | ✅ Implemented | UI for adding community games exists |
| Game repository | ⚠️ Partial | Basic UI exists but needs backend integration |

## Rewards System

| Feature | Status | Notes |
|---------|--------|-------|
| Reward points for chores | ✅ Implemented | Points are awarded and tracked in rewards.json |
| Points affect game time | ✅ Implemented | Available playtime is calculated from reward points |
| Visual reward tracking | ❌ Not Started | Need to implement UI for viewing point history |

## Chores

| Feature | Status | Notes |
|---------|--------|-------|
| Basic chore assignment | ✅ Implemented | Can assign chores to users |
| Kanban board | ✅ Implemented | Visual task management |
| Repeating chores | ❌ Not Started | Need to implement recurrence patterns |
| Chore evidence | ❌ Not Started | Need to implement proof of completion |
| Household chore bucket | ❌ Not Started | Need unassigned chore pool |
| Drag-and-drop assignment | ❌ Not Started | Need to implement drag functionality for assignment |
| Priority weights | ❌ Not Started | Need to implement priority system |
| Deadlines | ⚠️ Partial | Due dates exist but need better visualization |
| Notifications | ❌ Not Started | Need to implement notification system |

## Next Steps

1. Improve the chore system with repeating chores and the household chore bucket
2. Implement proper drag-and-drop functionality for chore assignment
3. Enhance reward tracking with a visual interface
4. Implement user management in the settings tab
5. Integrate community features for recipes and games with proper backend 