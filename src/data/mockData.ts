export type Meal = {
  id: number
  type: string
  name: string
  portion: string
  calories: number
  protein: number
  carbs: number
  fat: number
  time: string
  image: string
}

export const todaySummary = {
  calories: { current: 1480, goal: 2100 },
  macros: [
    { label: "Protein", value: 92, goal: 130, color: "#2f8f5b" },
    { label: "Carbs", value: 168, goal: 240, color: "#e5a83b" },
    { label: "Fat", value: 48, goal: 70, color: "#e87567" },
  ],
  steps: 7248,
  stepGoal: 10000,
  activeEnergy: 486,
}

export const initialMeals: Meal[] = [
  {
    id: 3,
    type: "Lunch",
    name: "Harvest chicken bowl",
    portion: "1 bowl",
    calories: 540,
    protein: 38,
    carbs: 52,
    fat: 18,
    time: "12:35 PM",
    image:
      "https://images.unsplash.com/photo-1543352634-a1c51d9f1fa7?auto=format&fit=crop&w=300&q=80",
  },
  {
    id: 2,
    type: "Breakfast",
    name: "Avocado egg toast",
    portion: "2 slices",
    calories: 430,
    protein: 22,
    carbs: 38,
    fat: 21,
    time: "8:10 AM",
    image:
      "https://images.unsplash.com/photo-1602881916963-5daf2d97c06e?auto=format&fit=crop&w=300&q=80",
  },
  {
    id: 1,
    type: "Snack",
    name: "Greek yogurt & berries",
    portion: "1 cup",
    calories: 210,
    protein: 16,
    carbs: 26,
    fat: 5,
    time: "Yesterday",
    image:
      "https://images.unsplash.com/photo-1605487821615-9dee8d69932e?auto=format&fit=crop&w=300&q=80",
  },
]

export const weeklyActivity = [
  { day: "M", steps: 6200, energy: 390 },
  { day: "T", steps: 8400, energy: 510 },
  { day: "W", steps: 7100, energy: 460 },
  { day: "T", steps: 9800, energy: 620 },
  { day: "F", steps: 7600, energy: 480 },
  { day: "S", steps: 11200, energy: 710 },
  { day: "S", steps: 7248, energy: 486 },
]

export const mockDelay = (ms = 450) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))
