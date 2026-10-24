import { findAllergens } from "./allergen-match";

describe("findAllergens", () => {
  it.each([
    ["Trứng gà", ["Eggs"], ["Eggs"]],
    ["Trứng gà", [" eggs "], [" eggs "]],
    ["Trứng gà".normalize("NFD"), ["Eggs"], ["Eggs"]],
    ["Cá hồi", ["Fish"], ["Fish"]],
    ["Cà chua", ["Fish"], []],
    ["Cám gạo", ["Fish"], []],
    ["Sữa chua", ["Milk or lactose"], ["Milk or lactose"]],
    ["Peanut butter", ["Peanuts"], ["Peanuts"]],
    ["Trứng vịt", ["Trứng"], ["Trứng"]],
    ["Thịt heo", ["Eggs", "Fish"], []],
  ])("%s with %j -> %j", (food, allergies, expected) => {
    expect(findAllergens(food, allergies)).toEqual(expected);
  });
});
