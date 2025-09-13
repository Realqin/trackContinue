# import json
# import datetime
# import os
# from collections import defaultdict
#
# def save_track_to_json(data, case_num=None, sample_type=None):
#     """
#     处理轨迹数据并保存为JSON格式供前端使用
#
#     Args:
#         data: 轨迹数据
#         case_num: 用例编号
#         sample_type: 样本类型（如"正样本"）
#     """
#
#     # 确保tracks目录存在
#     if not os.path.exists('tracks'):
#         os.makedirs('tracks')
#
#     # 生成文件名
#     timestamp = datetime.datetime.now().strftime("%Y%m%d%H%M%S")
#     if case_num is not None and sample_type is not None:
#         filename = f"{sample_type}-{case_num}-{timestamp}.json"
#     else:
#         filename = f"trajectory_data-{timestamp}.json"
#
#     # 保存为JSON文件到tracks目录
#     filepath = os.path.join('tracks', filename)
#
#     with open(filepath, 'w', encoding='utf-8') as f:
#         json.dump(data, f, ensure_ascii=False, indent=2)
#
#     print(f"已保存轨迹数据到 {filepath}")
#
# if __name__ == "__main__":
#     save_track_to_json([])
