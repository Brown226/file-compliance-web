using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Normative.Dao
{
    public class NormativeSql
    {
        public static string BatchInsertStandardSql
        {
            get
            {
                return @" INSERT INTO [dbo].[StandardInfo] (
[StandardOID],
[StandardNo],
[StandardName],
[PublishDate],
[ImplementDate],
[RepealDate],
[SpecialtyStr],
[CreateTime],
[CreateUser],
[PurchasingStatus],
[StandardStatus],
[FileName],
[StandardIdent]
) 
VALUES
";
            }
        }

        public static string BatchInsertStandardLogSql
        {
            get
            {
                return @" INSERT INTO [dbo].[StandardInfoLog] (
[StandardOID],
[StandardNo],
[StandardName],
[PublishDate],
[ImplementDate],
[RepealDate],
[SpecialtyStr],
[CreateTime],
[CreateUser],
[PurchasingStatus],
[StandardStatus],
[FileName],
[ModifyTime],
[ModifyUser],
[LogType],
[StandardIdent]
) 
VALUES
";
            }
        }

        public static string InsertStandardSql
        {
            get
            {
                return @" INSERT INTO [dbo].[StandardInfo] (
[StandardOID],
[StandardNo],
[StandardName],
[PublishDate],
[ImplementDate],
[RepealDate],
[SpecialtyStr],
[CreateTime],
[CreateUser],
[PurchasingStatus],
[StandardStatus],
[FileName],
[StandardIdent]
) 
VALUES
(
@StandardOID,
@StandardNo,
@StandardName,
@PublishDate,
@ImplementDate,
@RepealDate,
@SpecialtyStr,
GetDate(),
@CreateUser,
@PurchasingStatus,
@StandardStatus,
@FileName,
@StandardIdent
)
";
            }
        }

        public static string InsertStandardLogSql
        {
            get
            {
                return @" INSERT INTO [dbo].[StandardInfoLog] (
[StandardOID],
[StandardNo],
[StandardName],
[PublishDate],
[ImplementDate],
[RepealDate],
[SpecialtyStr],
[CreateTime],
[CreateUser],
[PurchasingStatus],
[StandardStatus],
[FileName],
[ModifyTime],
[ModifyUser],
[LogType],
[StandardIdent]
) 
VALUES
(
@StandardOID,
@StandardNo,
@StandardName,
@PublishDate,
@ImplementDate,
@RepealDate,
@SpecialtyStr,
@CreateTime,
@CreateUser,
@PurchasingStatus,
@StandardStatus,
@FileName,
GetDate(),
@ModifyUser,
@LogType,
@StandardIdent
)
";
            }
        }

        public static string GetStandardSql
        {
            get
            {
                return @"SELECT * FROM StandardInfo ";
            }
        }

        public static string GetStandardByOidSql
        {
            get
            {
                return @"SELECT * FROM StandardInfo WHERE StandardOID in @StandardOIDs";
            }
        }

        public static string DelStandardSql
        {
            get
            {
                return @"Delete from StandardInfo where StandardOID in @StandardOIDs";
            }
        }

        public static string GetUserSql
        {
            get
            {
                return @"select
	[User].[RTXID],
	[User].[RTXName],
	[User].[IsUsing],
	[User].[CreatedTime],
	[User].[SpecialtyStr],
	[User].[RoleCode],
	[User].[Mdb]
    from  [dbo].[User]
    where [User].[IsUsing] = 1 and [User].RTXID=@RTXID
";
            }
        }

        public static string GetEnumsSql
        {
            get
            {
                return @"select
    [Enums].[EnumType],
	[Enums].[Value],
	[Enums].[ValueStr],
	[Enums].[ValueCode]
    from [dbo].[Enums] Where InUsing = 1";
            }
        }

        public static string GetSoftVersionSql
        {
            get
            {
                return @"select CurrentVersion from SoftVersion where Islast=1";
            }
        }

    }
}
