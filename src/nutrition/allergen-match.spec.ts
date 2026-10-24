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
    ["Nuts, almonds", ["Tree nuts"], ["Tree nuts"]],
    ["Prawns", ["Shellfish"], ["Shellfish"]],
    ["Soybeans, mature seeds", ["Soy"], ["Soy"]],
    ["Ice creams, vanilla", ["Milk or lactose"], ["Milk or lactose"]],
    ["Nước mắm", ["Fish"], ["Fish"]],
    ["Bánh mì", ["Wheat or gluten"], ["Wheat or gluten"]],
  ])("%s with %j -> %j", (food, allergies, expected) => {
    expect(findAllergens(food, allergies)).toEqual(expected);
  });
});
