import ast
import configparser
import random

import pymysql
import json
from datetime import datetime, timezone
from openpyxl import Workbook
from openpyxl import load_workbook
from datetime import datetime
from dateutil import tz


def read_config(config_file='config.ini'):
    """
    读取配置文件
    :param config_file: 配置文件路径
    :return: 配置对象
    """
    config = configparser.ConfigParser()
    config.read(config_file)
    return config


def get_db_connection():
    """
    获取数据库连接
    :return: 数据库连接对象
    """
    # 读取配置
    config = read_config()
    host = config.get('database', 'host')
    port = config.getint('database', 'port')
    database = config.get('database', 'database')
    table = config.get('database', 'table')

    # 连接数据库
    connection = pymysql.connect(
        host=host,
        port=port,
        user='root',
        password='',  # 实际使用时需要配置密码
        database=database,
        charset='utf8mb4'
    )
    print("连接数据库成功")
    return connection


def execute_query(sql, params=None):
    """
    执行数据库查询的通用函数
    :param sql: SQL查询语句
    :param params: 查询参数
    :return: 查询结果
    """
    connection = get_db_connection()
    result = []
    try:
        with connection.cursor() as cursor:
            # 执行查询
            print("执行查询:", sql, params)
            cursor.execute(sql, params)
            result = cursor.fetchall()
            print(f"查询结果: {result}")
    finally:
        connection.close()

    return result


def fetch_trajectory_data(start_time, end_time):
    """
    从数据库读取轨迹数据
    
    :param start_time: 开始时间
    :param end_time: 结束时间
    :return: 符合条件的数据列表
    """
    # 读取配置
    config = read_config()
    table = config.get('database', 'table')

    # 构造查询SQL
    # 查询某个时间段内duration值大于1h（转换为秒），且displacement/rangeMaxDistance < 3的id数据前100条的数据
    sql = f"""
    SELECT id, longitude, latitude, speed, course, len, lastTm, displacement, rangeMaxDistance, duration
    FROM {table}
    WHERE lastTm BETWEEN %s AND %s
    AND duration > 3600
    AND displacement/rangeMaxDistance < 3
    AND rangeMaxDistance > 1000
    ORDER BY lastTm DESC
    LIMIT 100
    """

    rows = execute_query(sql, (start_time, end_time))

    result = []
    # 格式化数据
    for row in rows:
        # 处理时间戳，数据库中是毫秒时间戳格式
        # last_tm_timestamp = row[6] / 1000  # 转换为秒级时间戳
        # last_tm_formatted = datetime.datetime.fromtimestamp(last_tm_timestamp).strftime('%Y-%m-%d %H:%M:%S')

        item = {
            "longitude": row[1],
            "latitude": row[2],
            "speed": row[3],
            "course": row[4],
            "len": row[5],
            "lastTm": row[6],
            "id": row[0]  # 添加ID字段
        }
        result.append(item)

    return result


def fetch_target_ids(table, start_time, end_time, tests_sample_size):
    """
    从数据库读取符合条件的ID列表
    
    :param start_time: 开始时间
    :param end_time: 结束时间
    :return: ID列表
    """

    # 构造查询SQL
    sql = f"""
    SELECT id,count(*)
    FROM {table}
    WHERE lastdt BETWEEN %s AND %s
      AND duration > 3600000          -- 注意：时间单位是毫秒，3600秒 = 3600000毫秒
      AND rangeMaxDistance > 1000
      AND displacement / rangeMaxDistance < 3
    group by id
    having count(*) > 100
    LIMIT %s
    """

    rows = execute_query(sql, (start_time, end_time, tests_sample_size))
    # 提取ID列表
    target_id_list = [row[0] for row in rows]
    return target_id_list


# 遍历每个id在最近1h内的轨迹点，按lastdt倒序，第一部分，每隔track_extract_time取一个点，取10个点--》空track_gap_range--》继续按间隔取10个点
def extract_track_points(table, ids, end_time, track_extract_time, track_gap_range, track_sample_size):
    """
    从数据库读取符合条件的轨迹点

    :param id: 轨迹ID
    :param start_time: 开始时间
    :param end_time: 结束时间
    :return: 轨迹点列表
    """
    # 构造查询SQL
    sql = f"""
    SELECT id,longitude, latitude, speed, course, len, lastTm,lastdt
    FROM {table}
    WHERE id = %s
    AND lastTm BETWEEN %s AND %s
    ORDER BY lastTm DESC
    """
    beijing = tz.gettz("Asia/Shanghai")
    dt = datetime.strptime(end_time, "%Y-%m-%d %H:%M:%S").replace(tzinfo=beijing)
    lasttm = int(dt.timestamp() * 1000)
    print("track_gap_range:", track_gap_range)
    print(type(track_gap_range))
    # 随机一个gap范围值
    track_gap_range = ast.literal_eval(track_gap_range)
    print(type(track_gap_range))
    track_extract_time = int(track_extract_time)

    print("sql:", sql)
    track_points = []
    for id in ids:
        # 每个目标都去查轨迹点
        points = execute_query(sql, (id, lasttm - 3600000, lasttm))
        gap_range = random.randint(track_gap_range[0], track_gap_range[1])
        print("gap_range:", gap_range)
        flag_num = 1
        flag_time = 0
        result = []
        disappear_points = []
        appear_points = []
        for point in points:
            # 处理时间戳，数据库中是毫秒时间戳格式
            # last_tm_timestamp = row[6] / 1000  # 转换为秒级时间戳
            # last_tm_formatted = datetime.datetime.fromtimestamp(last_tm_timestamp).strftime('%Y-%m-%d %H:%M:%S')

            item = {
                "id": point[0],
                "longitude": f'{point[1]}',
                "latitude": f'{point[2]}',
                "speed": point[3],
                "course": point[4],
                "len": point[5],
                "lastTm": point[6],
                "lastdt": point[7].strftime("%Y-%m-%d %H:%M:%S"),
            }
            print("item:", item)
            # 是否为第一个点，是就直接入库，否则按时间抽点
            if len(appear_points) == 0:
                appear_points.append(item)
                flag_time = item['lastTm']
                print("flag_num:", flag_num)
                flag_num += 1
            elif (flag_num <= track_sample_size) and ((flag_time - item['lastTm']) > (track_extract_time * 60 * 1000)):
                aa = flag_time - item['lastTm']
                print("aa:", aa / 60 / 1000)
                # 时间间隔是否超过track_extract_time，是就取当前点
                appear_points.append(item)
                flag_time = item['lastTm']
                print("flag_num:", flag_num)
                flag_num += 1
            # 开始存生成轨迹点，必须满足间隔track_gap_range后取点
            elif (len(disappear_points) == 0) and ((
                    flag_time - item['lastTm']) > ((gap_range + track_extract_time) * 60 * 1000)) and (
                    flag_num > track_sample_size):

                bb = (flag_time - item['lastTm']) / 60 / 1000
                print("间隔:",bb )
                disappear_points.append(item)
                flag_time = item['lastTm']
                print("flag_num:", flag_num)
                flag_num += 1
            elif ((track_sample_size + 1) < flag_num <= (track_sample_size * 2)) and (
                    flag_time - item['lastTm'] > (track_extract_time  * 60 * 1000)):
                cc = (flag_time - item['lastTm']) / 60 / 1000
                print("间隔:", cc)
                disappear_points.append(item)
                flag_time = item['lastTm']
                print("flag_num:", flag_num)
                flag_num += 1
            elif flag_num > (track_sample_size * 2):
                break

            # else:
            #     # 时间间隔是否超过track_gap_range，是就取当前点
            #     if flag_time - item['lastTm']  > track_gap_range * 60 * 1000:
            #         result.append(item)
            #         flag_time = item['lastTm']
            #         flag_num += 1
            #     continue

            disappear_points.reverse()
            appear_points.reverse()
            print("disappear_points:", disappear_points)
            print("appear_points:", appear_points)

            # result.append(item)
            result.append(disappear_points)
            result.append(appear_points)
            # print("result:",result)
            print("\n")

    # return result
    #
    # print("rows:",rows)
    # # 提取ID列表
    # target_id_list = [row[0] for row in rows]
    # print("target_id_list:",target_id_list)
    # return target_id_list


def write_to_excel(data, excel_file, sheet_name='Sheet1'):
    """
    将数据写入Excel文件
    
    :param data: 要写入的数据
    :param excel_file: Excel文件路径
    :param sheet_name: 工作表名称
    """
    try:
        # 加载现有的Excel文件或创建新的
        try:
            workbook = load_workbook(excel_file)
        except FileNotFoundError:
            workbook = Workbook()

        # 选择或创建工作表
        if sheet_name in workbook.sheetnames:
            worksheet = workbook[sheet_name]
        else:
            worksheet = workbook.create_sheet(sheet_name)

        # 设置所有列为文本格式
        from openpyxl.styles import numbers
        for column in ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']:
            for row in range(1, len(data) + 2):  # +2 包括标题行和索引从1开始
                worksheet[f'{column}{row}'].number_format = numbers.FORMAT_TEXT

        # 写入表头
        headers = ["longitude", "latitude", "speed", "course", "len", "lastTm", "data_json", "id"]
        for col, header in enumerate(headers, 1):
            worksheet.cell(row=1, column=col, value=header)

        # 写入数据
        for row, item in enumerate(data, 2):
            # 通过在值前添加单引号来强制设置为文本格式
            worksheet.cell(row=row, column=1,
                           value=f"{item.get('longitude')}" if item.get('longitude') is not None else '')
            worksheet.cell(row=row, column=2,
                           value=f"{item.get('latitude')}" if item.get('latitude') is not None else '')
            worksheet.cell(row=row, column=3, value=f"{item.get('speed')}" if item.get('speed') is not None else '')
            worksheet.cell(row=row, column=4, value=f"{item.get('course')}" if item.get('course') is not None else '')
            worksheet.cell(row=row, column=5, value=f"{item.get('len')}" if item.get('len') is not None else '')
            worksheet.cell(row=row, column=6, value=f"{item.get('lastTm')}" if item.get('lastTm') is not None else '')
            # 将整个对象作为JSON字符串写入第七列
            worksheet.cell(row=row, column=7, value=f"{json.dumps(item, ensure_ascii=False)}")
            worksheet.cell(row=row, column=8, value=f"{item.get('id')}" if item.get('id') is not None else '')

        # 保存文件
        workbook.save(excel_file)
        print(f"数据已成功写入 {excel_file}")

    except Exception as e:
        print(f"写入Excel时出错: {e}")


def main():
    """
    主函数
    """
    # 示例时间范围，实际使用时请替换为需要的时间范围
    config = read_config()
    table = config.get('database', 'table')
    tests_sample_size = int(config.get('params', 'tests_sample_size'))
    track_sample_size = int(config.get('params', 'track_sample_size'))
    start_time = config.get('params', 'start_time')
    end_time = config.get('params', 'end_time')
    track_extract_time = config.get('params', 'track_extract_time')
    track_gap_range = config.get('params', 'track_gap_range')
    print("track_gap_range1:", track_gap_range)

    # 从数据库获取数据
    # data = fetch_trajectory_data(start_time, end_time)
    # print(f"共获取到 {len(data)} 条记录")

    # 获取ID列表
    target_ids = fetch_target_ids(table, start_time, end_time, tests_sample_size)
    print(f"获取到的ID列表: {target_ids}")
    extract_track_points(table, target_ids, end_time, track_extract_time, track_gap_range, track_sample_size)

    # # 将数据写入Excel
    # write_to_excel(data, "trajectory_data.xlsx", "轨迹数据")


# Press the green button in the gutter to run the script.
if __name__ == '__main__':
    main()

# See PyCharm help at https://www.jetbrains.com/help/pycharm/
