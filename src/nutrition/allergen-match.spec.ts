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
    ["Catfish, cooked", ["Fish"], ["Fish"]],
    ["Sardines, canned", ["Fish"], ["Fish"]],
    ["Nuts, mixed nuts", ["Tree nuts"], ["Tree nuts"]],
    ["Nuts, macadamia", ["Tree nuts"], ["Tree nuts"]],
    ["Buttermilk", ["Milk or lactose"], ["Milk or lactose"]],
    ["Kem vani", ["Milk or lactose"], ["Milk or lactose"]],
    ["Spaghetti, cooked", ["Wheat or gluten"], ["Wheat or gluten"]],
    ["Barley, pearled", ["Wheat or gluten"], ["Wheat or gluten"]],
    ["Soymilk, original", ["Soy"], ["Soy"]],
    ["Mollusks, scallop", ["Shellfish"], ["Shellfish"]],
    ["Eggplant", ["Eggs"], []],
  ])("%s with %j -> %j", (food, allergies, expected) => {
    expect(findAllergens(food, allergies)).toEqual(expected);
  });
});
