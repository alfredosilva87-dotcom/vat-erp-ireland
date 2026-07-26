import type { VatCategory, CreditRule } from "@/lib/types";

// Bundled base so the app works locally with just a GEMINI_API_KEY, before
// Supabase is wired. Mirrors db/seed_vat_categories.sql. When Supabase is
// configured the live base is used instead (maintained in the Rate base screen).
//
// NOTE: Irish VAT on food is nuanced. These are best-effort defaults for the
// certification phase — the accountant validates and refines in the Rate base.

const cat = (
  code: string,
  description: string,
  keywords: string[],
  vat_rate: number,
  rate_type: VatCategory["rate_type"],
  effective_from = "2000-01-01"
): VatCategory => ({
  id: code,
  code,
  description,
  keywords,
  vat_rate,
  rate_type,
  effective_from,
  effective_to: null,
  active: true,
});

export const FALLBACK_CATEGORIES: VatCategory[] = [
  // ---------- Zero-rated food (0%) ----------
  cat("FOOD-MEAT", "Meat & poultry (raw)", ["meat", "beef", "steak", "ribeye", "sirloin", "mince", "roast", "chicken", "wings", "breast", "thigh", "drumstick", "turkey", "duck", "pork", "bacon", "lardons", "ham", "gammon", "sausage", "sausages", "lamb", "chop", "fillet", "rasher", "rashers", "meatballs"], 0, "zero"),
  cat("FOOD-FISH", "Fish & seafood (raw)", ["fish", "salmon", "cod", "haddock", "tuna", "prawn", "prawns", "shrimp", "mackerel", "seafood", "pollock", "hake", "sardine", "sardines"], 0, "zero"),
  cat("FOOD-VEG", "Fresh vegetables", ["vegetable", "vegetables", "veg", "potato", "potatoes", "onion", "onions", "carrot", "carrots", "tomato", "tomatoes", "salad", "lettuce", "cucumber", "pepper", "peppers", "broccoli", "cauliflower", "mushroom", "mushrooms", "garlic", "spinach", "cabbage", "courgette", "celery", "leek", "leeks", "corn", "peas", "beans", "scallion", "ginger", "beetroot", "kale"], 0, "zero"),
  cat("FOOD-FRUIT", "Fresh fruit", ["fruit", "apple", "apples", "banana", "bananas", "orange", "oranges", "grape", "grapes", "berry", "berries", "strawberry", "strawberries", "blueberry", "raspberry", "lemon", "lime", "melon", "pear", "pineapple", "mango", "avocado", "kiwi", "peach", "plum"], 0, "zero"),
  cat("FOOD-DAIRY", "Dairy & eggs", ["milk", "cheese", "cheddar", "mozzarella", "butter", "yogurt", "yoghurt", "cream", "egg", "eggs", "brie", "feta", "parmesan"], 0, "zero"),
  cat("FOOD-BAKERY", "Bread & bakery", ["bread", "baguette", "roll", "rolls", "bagel", "bagels", "wrap", "wraps", "tortilla", "pitta", "naan", "croissant", "loaf", "brioche", "bun", "buns", "garlic bread"], 0, "zero"),
  cat("FOOD-GRAINS", "Rice, pasta, grains & flour", ["rice", "basmati", "pasta", "spaghetti", "penne", "noodle", "noodles", "flour", "oats", "oat", "cereal", "cornflakes", "couscous", "quinoa", "lentil", "lentils"], 0, "zero"),
  cat("FOOD-OILS", "Cooking oils & fats", ["oil", "olive oil", "sunflower oil", "vegetable oil", "rapeseed oil", "coconut oil", "lard", "ghee"], 0, "zero"),
  cat("FOOD-CONDIMENT", "Condiments, sauces & seasonings", ["mayo", "mayonnaise", "ketchup", "mustard", "sauce", "vinegar", "dressing", "salt", "pepper", "herb", "herbs", "spice", "spices", "stock", "gravy", "olive", "olives", "pesto", "honey", "jam", "marmalade", "relish", "chutney", "paste"], 0, "zero"),
  cat("FOOD-TINNED", "Tinned & packaged staples", ["tinned", "tin", "canned", "can", "soup", "chickpeas", "kidney beans", "baked beans", "sweetcorn"], 0, "zero"),
  cat("FOOD-WATER", "Bottled water (still)", ["water", "still water", "spring water", "mineral water"], 0, "zero"),
  cat("FOOD-TEACOFFEE", "Tea & coffee", ["tea", "teabags", "coffee", "espresso", "cappuccino"], 0, "zero"),

  // ---------- Standard-rated goods (23%) ----------
  cat("CONFECTIONERY", "Confectionery & chocolate", ["chocolate", "sweets", "candy", "sweet", "haribo", "biscuit", "biscuits", "cookie", "cookies", "wafer", "chocolate bar", "sweet bar"], 23, "standard"),
  cat("SNACKS", "Savoury snacks", ["crisps", "popcorn", "pretzel", "pretzels", "snack", "snacks", "tortilla chips", "nachos", "roasted nuts"], 23, "standard"),
  cat("ICE-CREAM", "Ice cream & frozen desserts", ["ice cream", "icecream", "gelato", "lolly", "sorbet"], 23, "standard"),
  cat("SOFTDRINK", "Soft drinks & sugary juices", ["soft drink", "cola", "coke", "pepsi", "fanta", "sprite", "soda", "lemonade", "juice", "energy drink", "redbull", "minerals", "fizzy"], 23, "standard"),
  cat("ALCOHOL", "Alcoholic drinks", ["beer", "lager", "wine", "spirits", "guinness", "vodka", "whiskey", "whisky", "gin", "cider", "prosecco", "rum", "champagne"], 23, "standard"),
  cat("HOUSEHOLD", "Household & cleaning products", ["detergent", "cleaner", "bleach", "washing", "dishwasher", "sponge", "bin bags", "foil", "cling film", "kitchen roll", "toilet roll", "tissue", "tissues", "fabric softener", "washing up"], 23, "standard"),
  cat("TOILETRIES", "Toiletries & cosmetics", ["shampoo", "soap", "toothpaste", "deodorant", "shower gel", "razor", "cosmetic", "makeup", "moisturiser", "conditioner", "sanitary", "shaving"], 23, "standard"),
  cat("SUPPLEMENTS", "Food supplements & vitamins", ["vitamin", "vitamins", "supplement", "supplements", "protein powder", "whey"], 23, "standard"),
  cat("PETFOOD", "Pet food & supplies", ["dog food", "cat food", "pet", "whiskas", "pedigree", "kibble", "cat litter"], 23, "standard"),
  cat("ELECTRONIC", "Electronics & appliances", ["electronics", "laptop", "phone", "appliance", "computer", "charger", "cable", "battery", "batteries", "headphones"], 23, "standard"),
  cat("ADULT-CLOTH", "Adult clothing & footwear", ["clothing", "shirt", "trousers", "jeans", "jacket", "shoes", "socks", "adult clothing"], 23, "standard"),
  cat("FURNITURE", "Furniture & homeware", ["furniture", "table", "chair", "desk", "sofa", "shelf", "lamp", "mattress"], 23, "standard"),
  cat("STATIONERY", "Stationery & office supplies", ["stationery", "paper", "pen", "pens", "notebook", "printer ink", "envelope", "envelopes", "stapler"], 23, "standard"),
  cat("FUEL-AUTO", "Vehicle fuel (petrol/diesel)", ["petrol", "diesel", "fuel", "unleaded"], 23, "standard"),

  // ---------- Reduced (13.5%) ----------
  cat("FUEL-DOM", "Domestic fuel: coal, peat, heating oil", ["coal", "peat", "heating oil", "briquettes", "turf", "firewood"], 13.5, "reduced"),
  cat("ELEC-GAS", "Electricity & gas (general use)", ["electricity", "gas", "esb", "energy bill"], 13.5, "reduced"),
  cat("CONSTRUCT", "Construction & repair services", ["construction", "building work", "repair service", "plumber", "electrician", "painting", "carpentry"], 13.5, "reduced"),
  cat("CLEANING-SVC", "Cleaning & maintenance services", ["cleaning service", "maintenance", "window cleaning", "laundry service"], 13.5, "reduced"),

  // ---------- Second reduced (9%) — changed 01/07/2026 ----------
  cat("CATERING", "Restaurant & catering services (prepared meals)", ["restaurant", "catering", "meal", "food service", "hot food", "takeaway", "lunch", "dinner", "cafe", "coffee shop"], 9, "second_reduced", "2026-07-01"),
  cat("HAIRDRESS", "Hairdressing services", ["hairdresser", "hairdressing", "haircut", "salon", "barber", "blow dry"], 9, "second_reduced", "2026-07-01"),
  cat("NEWS", "Newspapers, periodicals, e-books", ["newspaper", "magazine", "ebook", "e-book", "periodical"], 9, "second_reduced"),
  cat("SPORT", "Sporting facilities (use)", ["gym", "sports facility", "leisure centre", "swimming pool", "membership"], 9, "second_reduced"),

  // ---------- Livestock (4.8%) ----------
  cat("LIVESTOCK", "Live livestock (cattle, sheep, horses, greyhounds)", ["cattle", "sheep", "livestock", "horse", "greyhound", "heifer", "bullock", "ewe"], 4.8, "livestock"),

  // ---------- Zero-rated non-food ----------
  cat("CHILD-CLOTH", "Children's clothing & footwear", ["children clothing", "kids shoes", "baby clothes", "baby vest", "infant"], 0, "zero"),
  cat("MED-ORAL", "Oral medicines", ["oral medicine", "tablets", "medication", "paracetamol", "ibuprofen"], 0, "zero"),
  cat("BOOKS", "Printed books", ["book", "books", "textbook", "paperback"], 0, "zero"),

  // ---------- Exempt ----------
  cat("FINANCE", "Financial services & insurance", ["insurance", "financial service", "bank fee", "loan interest"], 0, "exempt"),
  cat("MEDICAL", "Medical & health services", ["doctor", "medical service", "dental", "gp visit", "physio"], 0, "exempt"),
  cat("EDUCATION", "Education services", ["education", "training course", "school fees", "tuition"], 0, "exempt"),
];

const rule = (
  activity_code: string,
  match_keywords: string[],
  deductible_default: boolean,
  rationale: string,
  priority: number,
  vat_category_id: string | null = null
): CreditRule => ({
  id: `${activity_code}-${priority}`,
  activity_code,
  vat_category_id,
  match_keywords,
  deductible_default,
  rationale,
  priority,
  active: true,
});

export const FALLBACK_CREDIT_RULES: CreditRule[] = [
  rule("*", ["entertainment", "client entertainment", "hospitality event"], false, "Entertainment is not deductible in Ireland (legal block).", 10),
  rule("*", ["petrol"], false, "Passenger-car petrol is generally not deductible.", 11),
  rule("*", ["hotel", "accommodation"], false, "Accommodation/meals out may be restricted — review.", 12),
  rule("RESTAURANT", ["prawn", "prawns", "shrimp", "fish", "salmon", "meat", "beef", "steak", "chicken", "wings", "pork", "bacon", "lardons", "lamb", "vegetable", "potato", "onion", "tomato", "carrot", "garlic", "rice", "pasta", "flour", "oil", "milk", "cheese", "egg", "eggs", "salt", "spice", "sauce", "bread", "ingredient"], true, "Kitchen input for the restaurant — used in the taxable activity, gives credit.", 50),
  rule("RESTAURANT", ["kitchen equipment", "oven", "fridge", "utensil", "cookware"], true, "Kitchen equipment used in operations — deductible.", 51),
  rule("RESTAURANT", ["cleaning product", "detergent", "packaging", "napkin", "foil"], true, "Operational consumables — deductible.", 52),
  rule("RETAIL", ["stock", "goods for resale", "inventory"], true, "Goods for resale — direct input, gives credit.", 50),
  rule("*", ["*"], false, "No specific rule — review manually before taking credit.", 999),
];
