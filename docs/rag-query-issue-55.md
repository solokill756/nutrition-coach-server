# Đánh giá truy vấn RAG theo chủ đề

Truy vấn mới nhắm vào bệnh nền, dị ứng và chất dinh dưỡng cần tìm. Tên bữa chỉ được thêm khi tạo công thức cho một bữa cụ thể. Ngưỡng định lượng và số liệu trong ngày tiếp tục nằm trong prompt sinh nội dung. [Issue #55](https://github.com/solokill756/nutrition-coach-server/issues/55)

## Điều kiện đo

- So sánh hàm tạo truy vấn trước thay đổi ở commit `539b6e2` và hàm mới, cùng code retrieval và cùng snapshot 213 đoạn đang hoạt động trong PostgreSQL local.
- Mỗi chế độ dùng năm hồ sơ Dashboard giả lập và hai lượt kiểm tra cho Recipe Builder và phân bổ nguyên liệu. So sánh ghép cặp giữ nguyên `TOP_K=6`, điểm tối thiểu 0,6 và giới hạn 6.000 ký tự.
- Chạy BM25 qua nhánh dự phòng của backend. Với hybrid, mỗi lượt lấy được embedding `bge-m3` 1.024 chiều và kết quả từ pgvector. Tắt mở rộng và LLM rerank ở phép so sánh chính để chỉ đo khác biệt của truy vấn.
- Chấm thủ công theo nội dung thực sự vào prompt. Một đoạn được tính là liên quan nếu có thông tin áp dụng trực tiếp cho nhu cầu của ca. Ca tăng huyết áp ưu tiên đọc nhãn và chọn món ít natri. Ca đái tháo đường ưu tiên chọn và định lượng carbohydrate. Ca dị ứng ưu tiên đọc nhãn và tránh trứng. Ca phổ thông ưu tiên chọn nhóm thực phẩm và kết hợp bữa ăn. Với ca nhiều bệnh, một đoạn có thể đáp ứng một trong hai nhu cầu.
- Độ trễ đo từ lúc gọi retrieval đến khi ghép xong đoạn tham chiếu, với model đã nạp và một lượt đo cho mỗi truy vấn. Cache embedding có thể ảnh hưởng thứ tự đo, đặc biệt khi truy vấn cũ của tạo món và phân bổ giống hệt nhau.

## Kết quả

Trong cột đoạn tham chiếu, các số in đậm là đoạn được chấm liên quan. Tên tương ứng nằm bên dưới.

| Chế độ | Ca | Đoạn trước → sau | Liên quan trước → sau | Ký tự tham chiếu trước → sau | Retrieval trước → sau (ms) |
| --- | --- | --- | --- | ---: | ---: |
| BM25 | Tăng huyết áp | **1**, 2 → **1**, 3, **4** | 1/2 → 2/3 | 5578 → 5803 | 19 → 5 |
| BM25 | Đái tháo đường | 1, 8 → **5**, 6, 7 | 0/2 → 1/3 | 5386 → 5867 | 9 → 4 |
| BM25 | Dị ứng trứng | 9, **10** → **11**, 12, 13 | 1/2 → 1/3 | 5992 → 5808 | 5 → 2 |
| BM25 | Tăng huyết áp + đái tháo đường | **1**, 8 → **5**, 6, **14** | 1/2 → 2/3 | 5386 → 5558 | 6 → 9 |
| BM25 | Hồ sơ phổ thông | 2, **15** → **16**, **17** | 1/2 → 2/2 | 5224 → 5691 | 5 → 3 |
| BM25 | Tạo công thức tối, tăng huyết áp | 8, **18** → **4**, 3, **1** | 1/2 → 2/3 | 5971 → 5803 | 5 → 3 |
| BM25 | Phân bổ nguyên liệu, tăng huyết áp | 8, **18** → **4**, 3, **1** | 1/2 → 2/3 | 5971 → 5803 | 6 → 4 |
| Hybrid | Tăng huyết áp | **1**, **20** → **14**, **1**, 19 | 2/2 → 2/3 | 4765 → 6000 | 288 → 77 |
| Hybrid | Đái tháo đường | 21, 1 → **5**, 22, 3, 14 | 0/2 → 1/4 | 3554 → 5646 | 281 → 98 |
| Hybrid | Dị ứng trứng | 6, 9 → **11**, 23, 12 | 0/2 → 1/3 | 5271 → 5730 | 239 → 73 |
| Hybrid | Tăng huyết áp + đái tháo đường | **1**, 24 → **5**, **14**, 3 | 1/2 → 2/3 | 5408 → 4683 | 275 → 106 |
| Hybrid | Hồ sơ phổ thông | 28, 29, 21 → **25**, **26**, **27** | 0/3 → 3/3 | 4246 → 5282 | 181 → 69 |
| Hybrid | Tạo công thức tối, tăng huyết áp | **18**, 24 → **14**, 3, **30** | 1/2 → 2/3 | 5993 → 4972 | 252 → 71 |
| Hybrid | Phân bổ nguyên liệu, tăng huyết áp | **18**, 24 → **14**, 3, 19 | 1/2 → 1/3 | 5993 → 4137 | 19 → 70 |

| Dashboard | Liên quan trước → sau | Trung vị ký tự truy vấn trước → sau | Trung vị retrieval trước → sau |
| --- | --- | ---: | ---: |
| BM25 | 4/10 → 8/14 | 539 → 94 | 6 ms → 4 ms |
| Hybrid | 3/11 → 9/16 | 539 → 94 | 275 ms → 77 ms |

Truy vấn mới tìm được hướng dẫn về carbohydrate ở ca đái tháo đường và đã đưa tài liệu cho cả hai bệnh vào prompt của ca kết hợp. Ca dị ứng vẫn lẫn đoạn về chủ đề khác hoặc xử lý triệu chứng. Truy vấn ngắn hơn có thể trả nhiều đoạn đủ điều kiện hơn, nên phần tham chiếu đôi khi dài hơn dù vẫn nằm trong giới hạn.

### Tác động của mở rộng truy vấn

Đo riêng ca Dashboard tăng huyết áp trên hybrid, giữ nguyên các điều kiện còn lại và bật mở rộng bằng Gemini. Mỗi phiên bản tạo bốn biến thể bên cạnh truy vấn gốc.

| Phiên bản | Các đoạn thực sự đưa vào prompt | Ký tự tham chiếu | Retrieval |
| --- | --- | ---: | ---: |
| Trước | DASH — A Week With the DASH Eating Plan | 5.992 | 1.607 ms |
| Sau | DASH — Nutrition Facts Label Guide, DASH — DASH Nutrition Planning, NHLBI — Why DASH Works / Healthy Eating, Proven Results | 5.237 | 1.362 ms |

So với lượt tắt mở rộng, bước này thêm khoảng 1,3 giây vào lượt truy xuất mới và thay đổi tập đoạn. Đây là một cặp gọi Gemini, nên số đo không dùng để dự đoán độ trễ ổn định. Phép thử đánh giá đoạn tham chiếu, chưa đo chất lượng câu trả lời được sinh.

### Tên các đoạn

1. [DASH — Nutrition Facts Label Guide](https://www.nhlbi.nih.gov/sites/default/files/publications/WES10-DASH-OverviewGuide.pdf)
2. [WHO — Healthy diet / WHO response](https://www.who.int/news-room/fact-sheets/detail/healthy-diet)
3. [DASH — DASH Nutrition Planning (giới thiệu các tài liệu)](https://www.nhlbi.nih.gov/sites/default/files/publications/WES10-DASH-OverviewGuide.pdf)
4. [NHLBI — Heart-Healthy Living / Limit sodium](https://www.nhlbi.nih.gov/health/heart-healthy-living/healthy-foods)
5. [NIDDK — Healthy Living with Diabetes / Plan how much to eat or drink](https://www.niddk.nih.gov/health-information/diabetes/overview/healthy-living-with-diabetes)
6. [DASH — Next Level DASH](https://www.nhlbi.nih.gov/sites/default/files/publications/WES10-DASH-OverviewGuide.pdf)
7. [NIDDK — Healthy Living with Diabetes / mở đầu](https://www.niddk.nih.gov/health-information/diabetes/overview/healthy-living-with-diabetes)
8. [DASH — Why the DASH Eating Plan Works (DASH Website)](https://www.nhlbi.nih.gov/sites/default/files/publications/WES10-DASH-OverviewGuide.pdf)
9. [FDA — Food Allergies / What’s New](https://www.fda.gov/food/nutrition-food-labeling-and-critical-foods/food-allergies)
10. [FDA — Food Allergies / Major Food Allergens](https://www.fda.gov/food/nutrition-food-labeling-and-critical-foods/food-allergies)
11. [FDA — Food Allergies / Food Labels and Allergens](https://www.fda.gov/food/nutrition-food-labeling-and-critical-foods/food-allergies)
12. [FDA — Food Allergies / Additional Resources](https://www.fda.gov/food/nutrition-food-labeling-and-critical-foods/food-allergies)
13. [NIDDK — Healthy Eating for Adults with Chronic Kidney Disease / Track your liquids](https://www.niddk.nih.gov/health-information/kidney-disease/chronic-kidney-disease-ckd/eating-nutrition)
14. [NHLBI — TLC Guide / Sodium (Salt)](https://www.nhlbi.nih.gov/sites/default/files/publications/Your_Guide_to_Lowering_Your_Cholesterol_with_TLC.pdf)
15. [WHO — Healthy diet / Fats](https://www.who.int/news-room/fact-sheets/detail/healthy-diet)
16. [DASH — A Week With the DASH Eating Plan](https://www.nhlbi.nih.gov/sites/default/files/publications/WES10-DASH-OverviewGuide.pdf)
17. [DASH — Making the Move to DASH](https://www.nhlbi.nih.gov/sites/default/files/publications/WES10-DASH-OverviewGuide.pdf)
18. [WHO — Healthy diet / Protein, sodium và potassium](https://www.who.int/news-room/fact-sheets/detail/healthy-diet)
19. [NHLBI — Why DASH Works / Healthy Eating, Proven Results](https://www.nhlbi.nih.gov/sites/default/files/publications/WhyDASHWorks_UpdateNov20.pdf)
20. [DASH — What’s on Your Plate? / phiếu theo dõi](https://www.nhlbi.nih.gov/sites/default/files/publications/WES10-DASH-OverviewGuide.pdf)
21. [NHLBI — Why DASH Works / Daily Nutrient Levels](https://www.nhlbi.nih.gov/sites/default/files/publications/WhyDASHWorks_UpdateNov20.pdf)
22. [NIDDK — Healthy Living with Diabetes / Physical activity](https://www.niddk.nih.gov/health-information/diabetes/overview/healthy-living-with-diabetes)
23. [FDA — Food Allergies / What to Do If Symptoms Occur](https://www.fda.gov/food/nutrition-food-labeling-and-critical-foods/food-allergies)
24. [DASH — Why the DASH Eating Plan Works (đoạn trùng chủ đề)](https://www.nhlbi.nih.gov/sites/default/files/publications/WES10-DASH-OverviewGuide.pdf)
25. [NHLBI — Heart-Healthy Living / Foods to eat](https://www.nhlbi.nih.gov/health/heart-healthy-living/healthy-foods)
26. [WHO — Healthy diet / Vitamins and minerals](https://www.who.int/news-room/fact-sheets/detail/healthy-diet)
27. [DASH — Following the DASH Eating Plan / thực phẩm theo nhóm](https://www.nhlbi.nih.gov/sites/default/files/publications/WES10-DASH-OverviewGuide.pdf)
28. [DASH — Tips to Keep on Track](https://www.nhlbi.nih.gov/sites/default/files/publications/WES10-DASH-OverviewGuide.pdf)
29. [NHLBI — TLC Guide / Body Weight Planner](https://www.nhlbi.nih.gov/sites/default/files/publications/Your_Guide_to_Lowering_Your_Cholesterol_with_TLC.pdf)
30. [NHLBI — TLC Guide / Putting TLC Into Action](https://www.nhlbi.nih.gov/sites/default/files/publications/Your_Guide_to_Lowering_Your_Cholesterol_with_TLC.pdf)
