/** The 50 test locations (prompt s18-map-provider-test.md, "The 50 locations"). */
import type { TestLocation } from "./types";

const nbo = (id: number, query: string, neighbourhood: string, aliases: string[] = []): TestLocation => ({
  id, query, neighbourhood, aliases, town: "Nairobi", county: "Nairobi", group: "Nairobi estates",
});
const landmark = (id: number, query: string, neighbourhood: string, aliases: string[] = []): TestLocation => ({
  id, query, neighbourhood, aliases, town: "Nairobi", county: "Nairobi", group: "Landmarks",
});
const satellite = (id: number, query: string, neighbourhood: string, town: string, county: string, aliases: string[] = []): TestLocation => ({
  id, query, neighbourhood, aliases, town, county, group: "Satellite towns",
});
const city = (
  group: "Mombasa" | "Kisumu" | "Nakuru",
  id: number, query: string, neighbourhood: string, town: string, county: string, aliases: string[] = [],
): TestLocation => ({ id, query, neighbourhood, aliases, town, county, group });

export const LOCATIONS: readonly TestLocation[] = [
  nbo(1, "Kilimani, Nairobi", "Kilimani"),
  nbo(2, "Argwings Kodhek Road, Kilimani", "Kilimani"),
  nbo(3, "Kileleshwa, Nairobi", "Kileleshwa"),
  nbo(4, "Lavington, Nairobi", "Lavington"),
  nbo(5, "Westlands, Nairobi", "Westlands"),
  nbo(6, "Parklands, Nairobi", "Parklands"),
  nbo(7, "South B, Nairobi", "South B"),
  nbo(8, "South C, Nairobi", "South C"),
  nbo(9, "Donholm, Nairobi", "Donholm"),
  nbo(10, "Umoja, Nairobi", "Umoja"),
  nbo(11, "Embakasi, Nairobi", "Embakasi"),
  nbo(12, "Kasarani, Nairobi", "Kasarani"),
  nbo(13, "Roysambu, Nairobi", "Roysambu"),
  nbo(14, "Kahawa West, Nairobi", "Kahawa West"),
  nbo(15, "Karen, Nairobi", "Karen"),
  nbo(16, "Lang'ata, Nairobi", "Lang'ata", ["Langata"]),
  nbo(17, "Runda, Nairobi", "Runda"),
  nbo(18, "Ridgeways, Kiambu Road", "Ridgeways"),
  landmark(19, "Yaya Centre, Kilimani", "Kilimani"),
  landmark(20, "Garden City Mall, Thika Road", "Roysambu", ["Garden City"]),
  landmark(21, "Adams Arcade, Ngong Road", "Adams Arcade", ["Woodley"]),
  satellite(22, "Ruaka, Kiambu", "Ruaka", "Ruaka", "Kiambu"),
  satellite(23, "Syokimau, Machakos", "Syokimau", "Syokimau", "Machakos"),
  satellite(24, "Kitengela, Kajiado", "Kitengela", "Kitengela", "Kajiado"),
  satellite(25, "Ongata Rongai, Kajiado", "Ongata Rongai", "Ongata Rongai", "Kajiado", ["Rongai"]),
  satellite(26, "Ngong, Kajiado", "Ngong", "Ngong", "Kajiado"),
  satellite(27, "Kikuyu, Kiambu", "Kikuyu", "Kikuyu", "Kiambu"),
  satellite(28, "Ruiru, Kiambu", "Ruiru", "Ruiru", "Kiambu"),
  satellite(29, "Membley, Ruiru", "Membley", "Ruiru", "Kiambu"),
  satellite(30, "Tatu City, Kiambu", "Tatu City", "Ruiru", "Kiambu"),
  satellite(31, "Juja, Kiambu", "Juja", "Juja", "Kiambu"),
  satellite(32, "Thika, Kiambu", "Thika", "Thika", "Kiambu"),
  satellite(33, "Athi River, Machakos", "Athi River", "Athi River", "Machakos", ["Mavoko"]),
  satellite(34, "Mlolongo, Machakos", "Mlolongo", "Mlolongo", "Machakos"),
  city("Mombasa", 35, "Nyali, Mombasa", "Nyali", "Mombasa", "Mombasa"),
  city("Mombasa", 36, "Bamburi, Mombasa", "Bamburi", "Mombasa", "Mombasa"),
  city("Mombasa", 37, "Shanzu, Mombasa", "Shanzu", "Mombasa", "Mombasa"),
  city("Mombasa", 38, "Tudor, Mombasa", "Tudor", "Mombasa", "Mombasa"),
  city("Mombasa", 39, "Mtwapa, Kilifi", "Mtwapa", "Mtwapa", "Kilifi"),
  city("Mombasa", 40, "Diani, Kwale", "Diani", "Ukunda", "Kwale", ["Diani Beach"]),
  city("Kisumu", 41, "Milimani, Kisumu", "Milimani", "Kisumu", "Kisumu"),
  city("Kisumu", 42, "Mamboleo, Kisumu", "Mamboleo", "Kisumu", "Kisumu"),
  city("Kisumu", 43, "Riat Hills, Kisumu", "Riat", "Kisumu", "Kisumu", ["Riat Hills"]),
  city("Kisumu", 44, "Nyalenda, Kisumu", "Nyalenda", "Kisumu", "Kisumu"),
  city("Kisumu", 45, "Oginga Odinga Street, Kisumu", "Kisumu CBD", "Kisumu", "Kisumu", ["Kisumu Central", "Oginga Odinga"]),
  city("Nakuru", 46, "Milimani, Nakuru", "Milimani", "Nakuru", "Nakuru"),
  city("Nakuru", 47, "Section 58, Nakuru", "Section 58", "Nakuru", "Nakuru"),
  city("Nakuru", 48, "Lanet, Nakuru", "Lanet", "Nakuru", "Nakuru"),
  city("Nakuru", 49, "Naka, Nakuru", "Naka", "Nakuru", "Nakuru"),
  city("Nakuru", 50, "Kenyatta Avenue, Nakuru", "Nakuru CBD", "Nakuru", "Nakuru", ["Nakuru Central", "Kenyatta Avenue"]),
];

/** Places used for the tile comparison (decision 7), by location id. */
export const TILE_PLACES: readonly { key: string; label: string; locationId: number }[] = [
  { key: "kilimani", label: "Kilimani, Nairobi", locationId: 1 },
  { key: "ruaka", label: "Ruaka, Kiambu", locationId: 22 },
  { key: "kitengela", label: "Kitengela, Kajiado", locationId: 24 },
  { key: "nyali", label: "Nyali, Mombasa", locationId: 35 },
  { key: "milimani-kisumu", label: "Milimani, Kisumu", locationId: 41 },
  // Milimani, Nakuru (#46) has no usable reference point (amendment A8); the town centre stands in.
  { key: "nakuru-cbd", label: "Kenyatta Avenue, Nakuru", locationId: 50 },
];

export const TILE_ZOOMS = [13, 15, 17] as const;
